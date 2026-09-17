package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	feedPath   = "/api/v1/feed"
	sourceSlug = "cisa-kev"
	// sre-tab's FEED_MAX_PAGE_SIZE. Its 90-day retention has held 60 to 90 entries so far, so one page is the usual
	// case and the cap below is headroom, not an expected path.
	pageSize = 100
	maxPages = 10
	// A full page measured 62 KiB. Anything near this is not a feed page.
	maxBodyBytes   = 2 << 20
	requestTimeout = 30 * time.Second

	// SnapshotName is the file the site fetches as /feeds/kev.json (deploy/Caddyfile).
	SnapshotName = "kev.json"
	// FormatVersion changes when the page's reader (src/kev/snapshot.ts) must change with it.
	FormatVersion = 1

	maxNameRunes        = 200
	maxDescriptionRunes = 800
)

// Snapshot is the document the site serves. Only fields a visitor sees: sre-tab's item carries its owner's read and
// bookmark state, and none of that is copied.
type Snapshot struct {
	Version   int       `json:"version"`
	FetchedAt time.Time `json:"fetched_at"`
	Entries   []Entry   `json:"entries"`
}

type Entry struct {
	CVE string `json:"cve"`
	// Empty when sre-tab's title was the bare ID.
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Added       time.Time `json:"added"`
	// Federal remediation deadline, YYYY-MM-DD; empty when the summary did not state one.
	Due        string `json:"due,omitempty"`
	Ransomware bool   `json:"ransomware"`
	// CISA's catalogue entry. Empty unless it is an https URL on www.cisa.gov.
	URL string `json:"url,omitempty"`
}

// The subset of sre-tab's FeedPage this reads. Decoding into it is what drops everything else.
type feedPage struct {
	Items      []feedItem `json:"items"`
	NextCursor *string    `json:"next_cursor"`
}

type feedItem struct {
	CanonicalURL string    `json:"canonical_url"`
	Title        string    `json:"title"`
	Summary      *string   `json:"summary"`
	PublishedAt  time.Time `json:"published_at"`
	Source       struct {
		Slug string `json:"slug"`
	} `json:"source"`
}

// The shapes app/ingest/kev.py writes: "<CVE>: <vulnerabilityName>" and a summary of the description, then an
// optional ransomware sentence, then an optional deadline sentence, in that order.
var (
	titlePattern       = regexp.MustCompile(`^(CVE-\d{4}-\d{4,})(?::\s+(.+))?$`)
	dueSuffix          = regexp.MustCompile(`(?:^|\s)Federal remediation due (\d{4}-\d{2}-\d{2})\.$`)
	ransomwareSentence = "Known to be used in ransomware campaigns."
)

type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

// Fetcher reads the KEV entries sre-tab holds.
type Fetcher struct {
	Client    httpDoer
	BaseURL   *url.URL
	Token     string
	UserAgent string
}

// NewClient refuses redirects: a PAT should reach sre-tab and nothing it points at.
func NewClient() *http.Client {
	return &http.Client{
		Timeout: requestTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// Fetch pages through the feed, newest first. It reports how many pages it read and whether it stopped at the cap.
func (f *Fetcher) Fetch(ctx context.Context) (items []feedItem, pages int, capped bool, err error) {
	cursor := ""
	seen := map[string]bool{}
	for pages < maxPages {
		page, err := f.page(ctx, cursor)
		if err != nil {
			return nil, pages, false, err
		}
		pages++
		items = append(items, page.Items...)
		if page.NextCursor == nil || *page.NextCursor == "" {
			return items, pages, false, nil
		}
		cursor = *page.NextCursor
		if seen[cursor] {
			return nil, pages, false, fmt.Errorf("sre-tab repeated a cursor after %d pages", pages)
		}
		seen[cursor] = true
	}
	return items, pages, true, nil
}

func (f *Fetcher) page(ctx context.Context, cursor string) (*feedPage, error) {
	target := f.BaseURL.JoinPath(feedPath)
	query := url.Values{"sources": {sourceSlug}, "limit": {strconv.Itoa(pageSize)}}
	if cursor != "" {
		query.Set("cursor", cursor)
	}
	target.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+f.Token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", f.UserAgent)

	resp, err := f.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", target.Redacted(), err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		return nil, errors.New("sre-tab answered 401: the token is unknown, revoked, or expired, or its owner has left the allow-list")
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("sre-tab answered %s for %s", resp.Status, target.Path)
	}
	if mediaType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type")); err != nil || mediaType != "application/json" {
		return nil, fmt.Errorf("sre-tab answered %q, not application/json", resp.Header.Get("Content-Type"))
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("reading the feed page: %w", err)
	}
	if len(body) > maxBodyBytes {
		return nil, fmt.Errorf("feed page is larger than %d bytes", maxBodyBytes)
	}
	var page feedPage
	if err := json.Unmarshal(body, &page); err != nil {
		return nil, fmt.Errorf("feed page is not the expected JSON: %w", err)
	}
	if page.Items == nil {
		return nil, errors.New("feed page has no items list")
	}
	return &page, nil
}

// Build turns feed items into a snapshot. It drops what it cannot use rather than failing, and fails only when nothing
// is left: the catalogue only grows and sre-tab keeps 90 days of it, so an empty result means something upstream broke,
// and publishing it would blank the panel.
func Build(items []feedItem, fetchedAt time.Time) (Snapshot, int, error) {
	entries := make([]Entry, 0, len(items))
	seen := map[string]bool{}
	dropped := 0
	for _, item := range items {
		entry, ok := toEntry(item)
		if !ok || seen[entry.CVE] {
			dropped++
			continue
		}
		seen[entry.CVE] = true
		entries = append(entries, entry)
	}
	if len(entries) == 0 {
		return Snapshot{}, dropped, fmt.Errorf("none of %d feed items is a usable KEV entry", len(items))
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if !entries[i].Added.Equal(entries[j].Added) {
			return entries[i].Added.After(entries[j].Added)
		}
		return entries[i].CVE > entries[j].CVE
	})
	return Snapshot{Version: FormatVersion, FetchedAt: fetchedAt.UTC().Truncate(time.Second), Entries: entries}, dropped, nil
}

func toEntry(item feedItem) (Entry, bool) {
	if item.Source.Slug != sourceSlug || item.PublishedAt.IsZero() {
		return Entry{}, false
	}
	match := titlePattern.FindStringSubmatch(strings.TrimSpace(item.Title))
	if match == nil {
		return Entry{}, false
	}
	entry := Entry{
		CVE:   match[1],
		Name:  clean(match[2], maxNameRunes),
		Added: item.PublishedAt.UTC(),
		URL:   catalogueURL(item.CanonicalURL),
	}
	if item.Summary != nil {
		entry.Description, entry.Due, entry.Ransomware = splitSummary(*item.Summary)
		entry.Description = clean(entry.Description, maxDescriptionRunes)
	}
	return entry, true
}

// splitSummary takes app/ingest/kev.py's summary apart again. A summary that does not end the expected way is kept
// whole, so a wording change upstream costs the structured fields, not the text.
func splitSummary(summary string) (description, due string, ransomware bool) {
	text := strings.TrimSpace(summary)
	if loc := dueSuffix.FindStringSubmatchIndex(text); loc != nil {
		candidate := text[loc[2]:loc[3]]
		if _, err := time.Parse(time.DateOnly, candidate); err == nil {
			due = candidate
			text = strings.TrimSpace(text[:loc[0]])
		}
	}
	if rest, ok := strings.CutSuffix(text, ransomwareSentence); ok && (rest == "" || strings.HasSuffix(rest, " ")) {
		ransomware = true
		text = strings.TrimSpace(rest)
	}
	return text, due, ransomware
}

func catalogueURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "www.cisa.gov" || parsed.User != nil {
		return ""
	}
	return parsed.String()
}

// clean collapses whitespace, drops control and format characters, and truncates to limit runes.
func clean(text string, limit int) string {
	var b strings.Builder
	space := false
	for _, r := range text {
		switch {
		case unicode.IsSpace(r):
			space = b.Len() > 0
			continue
		case r == utf8.RuneError || unicode.IsControl(r) || unicode.Is(unicode.Cf, r):
			continue
		}
		if space {
			b.WriteByte(' ')
			space = false
		}
		b.WriteRune(r)
	}
	out := b.String()
	if utf8.RuneCountInString(out) <= limit {
		return out
	}
	runes := []rune(out)
	return strings.TrimRight(string(runes[:limit-1]), " ") + "…"
}

// Write replaces dir/kev.json atomically. The temporary file is a dotfile, which Caddy is configured not to serve.
func Write(dir string, snapshot Snapshot) error {
	data, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(dir, ".kev-*.json")
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			tmp.Close()
			os.Remove(tmp.Name())
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		return err
	}
	// Caddy runs as the same uid, so 0600 would do; 0644 keeps the file readable to whoever inspects the volume.
	if err := tmp.Chmod(0o644); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), filepath.Join(dir, SnapshotName)); err != nil {
		return err
	}
	committed = true
	if d, err := os.Open(dir); err == nil {
		d.Sync()
		d.Close()
	}
	return nil
}
