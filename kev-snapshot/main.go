// Command kev-snapshot copies the CISA Known Exploited Vulnerabilities entries that sre-tab carries into a static
// document the site serves as /feeds/kev.json.
//
// It runs hourly on ny03 as darkflib-kev.service, from the site's own image, and writes into the volume darkflib-web
// mounts read-only. Visitors therefore never cause a request to sre-tab, and the internet-facing container never
// holds the token. A failed run leaves the previous snapshot in place; the page shows its age.
//
//	SRETAB_PAT=... kev-snapshot -out /srv/feeds
//	kev-snapshot -env-file .env -out .feeds          # local development
//
// The token comes from SRETAB_PAT (a Podman secret in production), or from an env file read as a table of values,
// never sourced, as deploy/install.sh reads install.env. Exit status is 0 on success, 1 when the fetch or the data
// fails, and 2 for a usage or configuration error.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	defaultBaseURL = "https://sretab.mikepreston.org"
	tokenVariable  = "SRETAB_PAT"
	userAgent      = "darkflib.com kev-snapshot (+https://github.com/Darkflib/darkflib.com)"
)

func main() {
	os.Exit(run(context.Background(), os.Args[1:], os.Getenv, os.Stdout, os.Stderr, NewClient(), time.Now))
}

func run(
	ctx context.Context,
	args []string,
	getenv func(string) string,
	stdout, stderr io.Writer,
	client httpDoer,
	now func() time.Time,
) int {
	flags := flag.NewFlagSet("kev-snapshot", flag.ContinueOnError)
	flags.SetOutput(stderr)
	out := flags.String("out", "/srv/feeds", "directory to write "+SnapshotName+" into")
	envFile := flags.String("env-file", "", "read "+tokenVariable+" from this file instead of the environment")
	base := flags.String("base-url", defaultBaseURL, "sre-tab's origin")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintf(stderr, "kev-snapshot: unexpected argument %q\n", flags.Arg(0))
		return 2
	}

	baseURL, err := url.Parse(*base)
	if err != nil || baseURL.Scheme != "https" || baseURL.Host == "" || baseURL.User != nil {
		fmt.Fprintf(stderr, "kev-snapshot: -base-url must be an https origin, not %q\n", *base)
		return 2
	}

	token := strings.TrimSpace(getenv(tokenVariable))
	source := tokenVariable
	if *envFile != "" {
		token, err = readEnvFile(*envFile, tokenVariable)
		source = tokenVariable + " in " + *envFile
		if err != nil {
			fmt.Fprintf(stderr, "kev-snapshot: %v\n", err)
			return 2
		}
	}
	if token == "" {
		fmt.Fprintf(stderr, "kev-snapshot: %s is not set\n", source)
		return 2
	}
	if strings.ContainsFunc(token, func(r rune) bool { return r <= ' ' || r > '~' }) {
		fmt.Fprintf(stderr, "kev-snapshot: %s contains whitespace or non-ASCII characters\n", source)
		return 2
	}

	if info, err := os.Stat(*out); err != nil || !info.IsDir() {
		fmt.Fprintf(stderr, "kev-snapshot: -out %s is not a directory\n", *out)
		return 2
	}

	fetcher := &Fetcher{Client: client, BaseURL: baseURL, Token: token, UserAgent: userAgent}
	items, pages, capped, err := fetcher.Fetch(ctx)
	if err != nil {
		fmt.Fprintf(stderr, "kev-snapshot: %v; the previous snapshot is unchanged\n", err)
		return 1
	}
	snapshot, dropped, err := Build(items, now())
	if err != nil {
		fmt.Fprintf(stderr, "kev-snapshot: %v; the previous snapshot is unchanged\n", err)
		return 1
	}
	if err := Write(*out, snapshot); err != nil {
		fmt.Fprintf(stderr, "kev-snapshot: writing the snapshot: %v\n", err)
		return 1
	}

	fmt.Fprintf(stdout, "kev-snapshot: wrote %d entries from %d page(s) to %s/%s", len(snapshot.Entries), pages, *out, SnapshotName)
	if dropped > 0 {
		fmt.Fprintf(stdout, "; dropped %d unusable or duplicate item(s)", dropped)
	}
	if capped {
		fmt.Fprintf(stdout, "; stopped at the %d-page cap", maxPages)
	}
	fmt.Fprintln(stdout)
	return 0
}

// readEnvFile returns the last assignment to name, with one layer of matching quotes removed. Nothing is expanded or
// executed.
func readEnvFile(path, name string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	value, found := "", false
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		rest, ok := strings.CutPrefix(line, name+"=")
		if !ok {
			continue
		}
		found = true
		value = strings.TrimSpace(rest)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	if !found {
		return "", errors.New(name + " is not assigned in " + path)
	}
	return value, nil
}
