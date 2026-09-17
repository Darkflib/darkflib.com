package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const token = "sretab_pat_test-0123456789"

var fixedNow = time.Date(2026, 9, 17, 18, 0, 0, 500, time.UTC)

// An item as sre-tab's /api/v1/feed returns it, owner state included.
func item(cve, name, summary, published string) map[string]any {
	title := cve
	if name != "" {
		title += ": " + name
	}
	return map[string]any{
		"id":            13430,
		"canonical_url": "https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=" + cve,
		"title":         title,
		"summary":       summary,
		"image_url":     nil,
		"published_at":  published,
		"source":        map[string]any{"slug": "cisa-kev", "name": "CISA Known Exploited Vulnerabilities", "icon_url": nil},
		"topics":        []string{"security"},
		"read":          true,
		"bookmarked":    true,
	}
}

func page(next any, items ...map[string]any) map[string]any {
	if items == nil {
		items = []map[string]any{}
	}
	return map[string]any{"items": items, "next_cursor": next}
}

// feedServer answers each GET with the next of pages, recording the requests it saw.
func feedServer(t *testing.T, pages ...map[string]any) (*httptest.Server, *[]*http.Request) {
	t.Helper()
	var seen []*http.Request
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Clone(context.Background()))
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `{"detail":"Not authenticated"}`)
			return
		}
		if len(seen) > len(pages) {
			t.Errorf("unexpected request %d: %s", len(seen), r.URL)
			w.WriteHeader(http.StatusTeapot)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(pages[len(seen)-1])
	}))
	t.Cleanup(server.Close)
	return server, &seen
}

func runAgainst(t *testing.T, server *httptest.Server, out string, env map[string]string, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	args = append([]string{"-out", out, "-base-url", server.URL}, args...)
	code := run(context.Background(), args, func(name string) string { return env[name] }, &stdout, &stderr, server.Client(), func() time.Time { return fixedNow })
	return code, stdout.String(), stderr.String()
}

func readSnapshot(t *testing.T, dir string) (Snapshot, map[string]any) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, SnapshotName))
	if err != nil {
		t.Fatal(err)
	}
	var snapshot Snapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	return snapshot, raw
}

func TestRunWritesOnlyPublicFields(t *testing.T) {
	server, seen := feedServer(t, page(nil,
		item("CVE-2026-87886", "Acronis Backup Incorrect Default Permissions Vulnerability",
			"Acronis Backup contains an incorrect default permissions vulnerability. Known to be used in ransomware campaigns. Federal remediation due 2026-09-19.",
			"2026-09-16T18:47:50.679600Z"),
		item("CVE-2026-1234", "", "Short.", "2026-09-14T00:00:00Z"),
	))
	out := t.TempDir()

	code, stdout, stderr := runAgainst(t, server, out, map[string]string{"SRETAB_PAT": " " + token + "\n"})
	if code != 0 {
		t.Fatalf("exit %d, stderr %q", code, stderr)
	}
	if !strings.Contains(stdout, "wrote 2 entries from 1 page(s)") {
		t.Errorf("stdout %q", stdout)
	}
	if strings.Contains(stdout+stderr, token) {
		t.Error("the token was printed")
	}

	request := (*seen)[0]
	if got := request.URL.Path; got != "/api/v1/feed" {
		t.Errorf("path %q", got)
	}
	if got := request.URL.Query(); got.Get("sources") != "cisa-kev" || got.Get("limit") != "100" || got.Has("cursor") {
		t.Errorf("query %v", got)
	}
	if got := request.Header.Get("Accept"); got != "application/json" {
		t.Errorf("Accept %q", got)
	}

	snapshot, raw := readSnapshot(t, out)
	want := Snapshot{
		Version:   1,
		FetchedAt: time.Date(2026, 9, 17, 18, 0, 0, 0, time.UTC),
		Entries: []Entry{
			{
				CVE:         "CVE-2026-87886",
				Name:        "Acronis Backup Incorrect Default Permissions Vulnerability",
				Description: "Acronis Backup contains an incorrect default permissions vulnerability.",
				Added:       time.Date(2026, 9, 16, 18, 47, 50, 679600000, time.UTC),
				Due:         "2026-09-19",
				Ransomware:  true,
				URL:         "https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=CVE-2026-87886",
			},
			{
				CVE:         "CVE-2026-1234",
				Description: "Short.",
				Added:       time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC),
				URL:         "https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=CVE-2026-1234",
			},
		},
	}
	if fmt.Sprintf("%+v", snapshot) != fmt.Sprintf("%+v", want) {
		t.Errorf("snapshot\n got %+v\nwant %+v", snapshot, want)
	}

	entry := raw["entries"].([]any)[0].(map[string]any)
	for _, private := range []string{"read", "bookmarked", "id", "topics", "source"} {
		if _, ok := entry[private]; ok {
			t.Errorf("snapshot entry carries %q", private)
		}
	}

	info, err := os.Stat(filepath.Join(out, SnapshotName))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Errorf("mode %v", info.Mode().Perm())
	}
	leftovers, _ := filepath.Glob(filepath.Join(out, ".*"))
	if len(leftovers) != 0 {
		t.Errorf("temporary files left behind: %v", leftovers)
	}
}

func TestRunFollowsCursors(t *testing.T) {
	server, seen := feedServer(t,
		page("c1", item("CVE-2026-0003", "Three", "", "2026-09-03T00:00:00Z")),
		page("c2", item("CVE-2026-0002", "Two", "", "2026-09-02T00:00:00Z")),
		page(nil, item("CVE-2026-0001", "One", "", "2026-09-01T00:00:00Z")),
	)
	out := t.TempDir()

	code, stdout, stderr := runAgainst(t, server, out, map[string]string{"SRETAB_PAT": token})
	if code != 0 {
		t.Fatalf("exit %d, stderr %q", code, stderr)
	}
	if !strings.Contains(stdout, "wrote 3 entries from 3 page(s)") {
		t.Errorf("stdout %q", stdout)
	}
	if got := []string{(*seen)[1].URL.Query().Get("cursor"), (*seen)[2].URL.Query().Get("cursor")}; got[0] != "c1" || got[1] != "c2" {
		t.Errorf("cursors %v", got)
	}
}

func TestRunStopsAtThePageCap(t *testing.T) {
	var pages []map[string]any
	for i := range maxPages {
		pages = append(pages, page(fmt.Sprintf("c%d", i), item(fmt.Sprintf("CVE-2026-%04d", i+1), "Name", "", "2026-09-01T00:00:00Z")))
	}
	server, seen := feedServer(t, pages...)

	code, stdout, stderr := runAgainst(t, server, t.TempDir(), map[string]string{"SRETAB_PAT": token})
	if code != 0 {
		t.Fatalf("exit %d, stderr %q", code, stderr)
	}
	if len(*seen) != maxPages || !strings.Contains(stdout, "stopped at the 10-page cap") {
		t.Errorf("%d requests, stdout %q", len(*seen), stdout)
	}
}

func TestRunKeepsThePreviousSnapshotOnFailure(t *testing.T) {
	cases := map[string]http.HandlerFunc{
		"unauthorised": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		},
		"server error": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadGateway)
		},
		// Set per run: it points at a second server that records whether the request followed.
		"redirect": nil,
		"html": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprint(w, `{"items": []}`)
		},
		"not json": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `<html>`)
		},
		"no items": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"detail": "nope"}`)
		},
		"empty feed": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			fmt.Fprint(w, `{"items": [], "next_cursor": null}`)
		},
		"nothing usable": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			bad := item("CVE-2026-0001", "Name", "", "2026-09-01T00:00:00Z")
			bad["source"] = map[string]any{"slug": "hacker-news"}
			json.NewEncoder(w).Encode(page(nil, bad, item("not a cve", "", "", "2026-09-01T00:00:00Z")))
		},
		"oversized": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"items": [], "padding": "`+strings.Repeat("x", maxBodyBytes)+`"}`)
		},
		"repeated cursor": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(page("same", item("CVE-2026-0001", "Name", "", "2026-09-01T00:00:00Z")))
		},
	}
	for name, handler := range cases {
		t.Run(name, func(t *testing.T) {
			var redirected bool
			target := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected = true }))
			defer target.Close()
			if handler == nil {
				handler = func(w http.ResponseWriter, r *http.Request) {
					http.Redirect(w, r, target.URL+"/stolen", http.StatusFound)
				}
			}
			server := httptest.NewTLSServer(handler)
			defer server.Close()
			client := NewClient()
			client.Transport = server.Client().Transport

			out := t.TempDir()
			previous := []byte(`{"version":1,"fetched_at":"2026-09-01T00:00:00Z","entries":[]}` + "\n")
			if err := os.WriteFile(filepath.Join(out, SnapshotName), previous, 0o644); err != nil {
				t.Fatal(err)
			}

			var stdout, stderr bytes.Buffer
			code := run(context.Background(), []string{"-out", out, "-base-url", server.URL},
				func(string) string { return token }, &stdout, &stderr, client, time.Now)
			if code != 1 {
				t.Errorf("exit %d, want 1; stderr %q", code, stderr.String())
			}
			if !strings.Contains(stderr.String(), "previous snapshot is unchanged") {
				t.Errorf("stderr %q", stderr.String())
			}
			if strings.Contains(stderr.String(), token) {
				t.Error("the token was printed")
			}
			if redirected {
				t.Error("a redirect was followed")
			}
			if got, _ := os.ReadFile(filepath.Join(out, SnapshotName)); !bytes.Equal(got, previous) {
				t.Errorf("snapshot changed to %q", got)
			}
		})
	}
}

func TestRunRejectsBadConfiguration(t *testing.T) {
	envFile := filepath.Join(t.TempDir(), ".env")
	os.WriteFile(envFile, []byte("# comment\nDARKFLIB_WEB_PORT=8082\n"), 0o600)
	notADirectory := filepath.Join(t.TempDir(), "file")
	os.WriteFile(notADirectory, nil, 0o600)

	cases := []struct {
		name string
		args []string
		env  map[string]string
		want string
	}{
		{"no token", nil, nil, "SRETAB_PAT is not set"},
		{"blank token", nil, map[string]string{"SRETAB_PAT": "  "}, "SRETAB_PAT is not set"},
		{"token with a space", nil, map[string]string{"SRETAB_PAT": "abc def"}, "whitespace"},
		{"token with a header break", nil, map[string]string{"SRETAB_PAT": "abc\r\nX-Evil: 1"}, "whitespace"},
		{"plain http", []string{"-base-url", "http://sretab.mikepreston.org"}, map[string]string{"SRETAB_PAT": token}, "https origin"},
		{"credentials in the url", []string{"-base-url", "https://user:pw@sretab.mikepreston.org"}, map[string]string{"SRETAB_PAT": token}, "https origin"},
		{"env file without the token", []string{"-env-file", envFile}, map[string]string{"SRETAB_PAT": token}, "not assigned"},
		{"missing env file", []string{"-env-file", envFile + ".missing"}, nil, "no such file"},
		{"out is a file", []string{"-out", notADirectory}, map[string]string{"SRETAB_PAT": token}, "not a directory"},
		{"stray argument", []string{"now"}, map[string]string{"SRETAB_PAT": token}, "unexpected argument"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			args := append([]string{"-out", t.TempDir()}, tc.args...)
			code := run(context.Background(), args, func(name string) string { return tc.env[name] },
				&stdout, &stderr, failingClient{t}, time.Now)
			if code != 2 {
				t.Errorf("exit %d, want 2", code)
			}
			if !strings.Contains(stderr.String(), tc.want) {
				t.Errorf("stderr %q, want %q", stderr.String(), tc.want)
			}
		})
	}
}

type failingClient struct{ t *testing.T }

func (c failingClient) Do(req *http.Request) (*http.Response, error) {
	c.t.Errorf("unexpected request to %s", req.URL)
	return nil, fmt.Errorf("no network in this test")
}

func TestReadEnvFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	content := strings.Join([]string{
		"# SRETAB_PAT=commented-out",
		"SRETAB_PAT=first",
		"OTHER_SRETAB_PAT=wrong",
		`  SRETAB_PAT="` + token + `"  `,
		"#DARKFLIB_WEB_PORT=8082",
	}, "\n")
	os.WriteFile(path, []byte(content), 0o600)
	got, err := readEnvFile(path, "SRETAB_PAT")
	if err != nil || got != token {
		t.Errorf("got %q, %v", got, err)
	}

	server, _ := feedServer(t, page(nil, item("CVE-2026-0001", "One", "", "2026-09-01T00:00:00Z")))
	code, _, stderr := runAgainst(t, server, t.TempDir(), map[string]string{"SRETAB_PAT": "ignored"}, "-env-file", path)
	if code != 0 {
		t.Errorf("exit %d with -env-file: %s", code, stderr)
	}
}

func TestBuild(t *testing.T) {
	summary := func(s string) *string { return &s }
	base := feedItem{CanonicalURL: "https://www.cisa.gov/x?search_api_fulltext=CVE-2026-0001", Title: "CVE-2026-0001: One", PublishedAt: fixedNow}
	base.Source.Slug = "cisa-kev"
	with := func(change func(*feedItem)) feedItem {
		copied := base
		change(&copied)
		return copied
	}

	items := []feedItem{
		with(func(i *feedItem) { i.Title = "CVE-2026-0002: Older"; i.PublishedAt = fixedNow.Add(-time.Hour) }),
		base,
		with(func(i *feedItem) { i.Title = "CVE-2026-0001: Duplicate" }),
		with(func(i *feedItem) { i.Title = "CVE-2026-0003: Other source"; i.Source.Slug = "lwn" }),
		with(func(i *feedItem) { i.Title = "CVE-26-1: Malformed" }),
		with(func(i *feedItem) { i.Title = "CVE-2026-0004: No date"; i.PublishedAt = time.Time{} }),
		with(func(i *feedItem) {
			i.Title = "CVE-2026-0005:   Spaced\tout  name "
			i.PublishedAt = fixedNow.Add(-2 * time.Hour)
			i.CanonicalURL = "javascript:alert(1)"
			i.Summary = summary("Line one\n\nline\a two\u200b.")
		}),
		with(func(i *feedItem) {
			i.Title = "CVE-2026-0006"
			i.PublishedAt = fixedNow.Add(-2 * time.Hour)
			i.CanonicalURL = "http://www.cisa.gov/insecure"
		}),
	}
	snapshot, dropped, err := Build(items, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if dropped != 4 {
		t.Errorf("dropped %d, want 4", dropped)
	}
	var got []string
	for _, e := range snapshot.Entries {
		got = append(got, fmt.Sprintf("%s|%s|%s|%s", e.CVE, e.Name, e.Description, e.URL))
	}
	want := []string{
		"CVE-2026-0001|One||https://www.cisa.gov/x?search_api_fulltext=CVE-2026-0001",
		"CVE-2026-0002|Older||https://www.cisa.gov/x?search_api_fulltext=CVE-2026-0001",
		"CVE-2026-0006|||",
		"CVE-2026-0005|Spaced out name|Line one line two.|",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("entries\n got %q\nwant %q", got, want)
	}
	if !snapshot.FetchedAt.Equal(fixedNow.Truncate(time.Second)) || snapshot.Version != FormatVersion {
		t.Errorf("header %v %d", snapshot.FetchedAt, snapshot.Version)
	}
}

func TestSplitSummary(t *testing.T) {
	cases := []struct {
		in, description, due string
		ransomware           bool
	}{
		{"Desc. Known to be used in ransomware campaigns. Federal remediation due 2026-09-19.", "Desc.", "2026-09-19", true},
		{"Desc. Federal remediation due 2026-09-19.", "Desc.", "2026-09-19", false},
		{"Desc. Known to be used in ransomware campaigns.", "Desc.", "", true},
		{"Federal remediation due 2026-09-19.", "", "2026-09-19", false},
		{"Known to be used in ransomware campaigns.", "", "", true},
		{"Plain description.", "Plain description.", "", false},
		// Not at the end, or not the exact wording: kept as text.
		{"Federal remediation due 2026-09-19. Then more.", "Federal remediation due 2026-09-19. Then more.", "", false},
		{"Desc. Federal remediation due 2026-13-45.", "Desc. Federal remediation due 2026-13-45.", "", false},
		{"Desc.Known to be used in ransomware campaigns.", "Desc.Known to be used in ransomware campaigns.", "", false},
		{"Desc. Federal remediation due 2026-09-19. Known to be used in ransomware campaigns.", "Desc. Federal remediation due 2026-09-19.", "", true},
	}
	for _, tc := range cases {
		description, due, ransomware := splitSummary(tc.in)
		if description != tc.description || due != tc.due || ransomware != tc.ransomware {
			t.Errorf("splitSummary(%q) = %q, %q, %v", tc.in, description, due, ransomware)
		}
	}
}

func TestClean(t *testing.T) {
	cases := []struct {
		in    string
		limit int
		want  string
	}{
		{"  a \n\t b  ", 10, "a b"},
		{"a\x00b\u202ec\ufffd", 10, "abc"},
		{"abcdef", 6, "abcdef"},
		{"abcdefg", 6, "abcde…"},
		{"abcd efg", 6, "abcd…"},
		{"ééééééé", 6, "ééééé…"},
	}
	for _, tc := range cases {
		if got := clean(tc.in, tc.limit); got != tc.want {
			t.Errorf("clean(%q, %d) = %q, want %q", tc.in, tc.limit, got, tc.want)
		}
	}
}
