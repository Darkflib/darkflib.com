# Darkflib

Personal site for the Darkflib persona: a cyberpunk interface backed by real browser telemetry, heading towards a
client-side Fault Lab (see `docs/conversation.json` for the design discussion and `docs/mockup.png` for the original
visual). React 19, Vite, and TypeScript; no CSS framework.

```sh
npm install
npm run dev          # http://127.0.0.1:5173
npm run build        # typecheck (app, worker, node) + production build to dist/
npm run preview      # serve dist/
npm run lint         # Biome lint + format check
npm run format       # apply Biome fixes
npm run test:e2e     # build, then Playwright across Chromium, Firefox, and WebKit
npm run images       # regenerate public/images from assets/source
npm run kev          # fetch a real KEV snapshot into .feeds/ (needs SRETAB_PAT in .env, and Go)
npm run fonts        # rebuild the Rajdhani files with corrected glyph bounding boxes (needs uv)
```

Playwright browsers are a one-off `npx playwright install chromium firefox webkit`.

Production image, locally (Docker or Podman):

```sh
docker build -f Containerfile --build-arg BUILD_SHA="$(git rev-parse HEAD)" -t darkflib.com:ci .
CONTAINER_ENGINE=docker KEEP=1 deploy/scripts/smoke.sh     # routes, headers, cache policy, hardening
npx playwright test -c playwright.deploy.config.ts         # browser check against that container
docker rm -f darkflib-smoke
```

## Layout

| Path                            | What                                                                        |
| ------------------------------- | --------------------------------------------------------------------------- |
| `src/components/`               | One component per panel, each with its own CSS file                         |
| `src/styles/`                   | Reset, self-hosted font faces, and global tokens and primitives             |
| `src/content.ts`                | Projects, featured posts and tools (linking to mikepreston.org), tech stack  |
| `src/kev/`                      | Reading and summarising the KEV snapshot the site serves at `/feeds/kev.json` |
| `kev-snapshot/`                 | The Go program that writes that snapshot on the server, hourly              |
| `src/sw/`                       | Service worker entry and the page↔worker message protocol                   |
| `src/telemetry/`                | Page-side telemetry sources, including the service worker store             |
| `build/`                        | Vite plugin that bundles the worker; build metadata                         |
| `tests/e2e/`, `tests/support/`  | Playwright specs and a per-worker static server for `dist/`                 |
| `tests/fixtures/`               | A real KEV snapshot, served by the dev server and the tests in place of the volume |
| `assets/source/`                | PNG masters for generated imagery (not shipped); `projects/` are square screenshot crops |
| `Containerfile`, `deploy/`      | Production image (Caddy + site), Quadlets, nginx vhost, scripts: see `deploy/README.md` |
| `tests/deploy/`                 | Browser check against the production image under its real headers          |

## Telemetry strip

Every value in the strip under the hero is read from the browser or the build, never simulated:

| Item      | Source                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------- |
| `SW`      | Service worker store: controlling, starting, failed, off, or unsupported; flags waiting updates |
| `BUILD`   | Commit SHA baked in at build time (`*` = dirty tree); build time in the tooltip                |
| `PROTO`   | `nextHopProtocol` of the document's navigation timing                                          |
| `EDGE`    | nginx cache status via `Server-Timing: edge`: HITs among subresources that crossed the network (`LOCAL` if all came from the browser cache, whose replayed headers are ignored; `—` with no edge) |
| `TTFB`    | `responseStart` of the navigation, plus `(CACHE)` when no bytes were transferred               |
| Bars      | Resource Timing for the last 62 subresource requests: log-scaled, dim when cached, magenta ≥ 800 ms |
| `FPS`     | Frames rendered in the last second, counted with `requestAnimationFrame`; magenta below 30     |
| `UTC`     | Wall clock, ticking on the second; hidden below 800 px wide, where only `LOCAL` fits           |
| `LOCAL`   | The same clock in the browser's time zone, which the tooltip names                             |

The bars will pick up Fault Lab latency injection with no extra wiring, since injected delays show up in Resource
Timing.

The footer is `position: sticky` at the bottom of the window. Being in flow, it sits below the last panel at the end of
the page rather than covering it, and `scroll-padding-bottom` keeps scrolled-to and focused elements clear of it. The
shell uses `overflow: clip`, since `hidden` would make it the footer's scroll container.

## Fault Lab

A `FAULT_LAB` section below the dashboard lets a visitor break things and watch the page recover. Everything happens in
their own browser: the service worker injects faults into that tab's requests only, and the origins stay healthy for
everyone else.

- **The system under test** (`src/lab/statusClient.ts`) polls a status document from `api.darkflib.com`, fails over to
  `api.darkflib.dev` (a different registrable domain, so genuinely cross-site), and probes `media.darkflib.com`. It
  applies per-attempt timeouts, retries with exponential backoff and full jitter, honours `Retry-After` (waiting out
  short ones, and backing off entirely for long ones), opens a circuit breaker per origin after consecutive failures,
  and serves the last good data when both APIs are down. It never talks to the worker: faults reach it only as failed
  requests.
- **The fault engine** (`src/sw/fault-engine.ts`) holds rules per tab and answers only matching requests: `offline`
  (network error, no request sent), `latency` (a delay, then the real request), and `status` (a synthetic 429 or 503 with
  `Retry-After`, no request sent), each with a probability. It refuses the site's own origin and never touches page
  loads, so the lab cannot break the page that runs it.
- **Control** (`src/lab/faultControl.ts`) sends `fault:set` and shows what the worker acknowledged, not what it sent.
  Rules live in worker memory, so it re-sends them when a batch arrives from a new worker instance (restarted or
  replaced). The panel stays disabled, and says why, unless the controlling worker reports `fault-injection`.
- **Observability:** the event log's `FAULT` rows (injections) and `CLIENT` rows (retries, circuit changes, failover,
  state) form one timeline, and the lab's polls feed the strip's latency bars. `EDGE` counts same-origin requests only.
- **Origins** serve static JSON from `lab/origins/` through the same Caddy image, with CORS and `Timing-Allow-Origin` for
  the site and `no-store`. `/lab/config.json` lists them, along with the client's timings; `enabled: false` switches
  polling off. The CSP's `connect-src` must list the same origins, and `smoke.sh` checks that it does.

`tests/e2e/fault-engine.spec.ts` drives the worker directly: each mode, what reaches the origin (counted by the test
server's stand-in origins), clearing, rejections, and per-tab scope. `tests/e2e/fault-lab.spec.ts` drives the panel:
failover, circuit open, half-open, and close, stale data, Retry-After handling, timeouts, reset, the outdated-worker
state, and re-sending rules after a worker restart (Chromium only, since stopping a worker needs DevTools). The test
server shortens the client's clock through the config, and enables polling only for these tests.

## Known exploited vulnerabilities

A `KNOWN_EXPLOITED` panel lists what CISA has seen exploited in the wild, taken from
[sre-tab](https://github.com/Darkflib/sre-tab), which already ingests the KEV catalogue. sre-tab's API needs a
credential, so the browser never talks to it: `kev-snapshot` (in the site's own image) runs hourly on the server,
pages through `/api/v1/feed?sources=cisa-kev` with a read-only PAT, and writes `kev.json` to a volume Caddy serves as
`/feeds/kev.json`. Visitors fetch one static file from this origin, and no request of theirs reaches sre-tab.

- **The snapshot carries only what a visitor sees.** The feed item's `read` and `bookmarked` flags are the token
  owner's reading history, and the fetcher never copies them. It keeps the CVE, the name, the description, the date
  added, and the deadline and ransomware flag it splits back out of sre-tab's summary text, plus CISA's own link when
  it is https on `www.cisa.gov`. `src/kev/snapshot.ts` re-checks all of that in the browser: this is a document from
  the network, whoever wrote it.
- **Failure is a missing panel, never a broken one.** A failed refresh leaves the previous file in place, so the page
  shows the last good data with its age; past three hours it is marked `STALE`, and past a week the panel hides
  itself. An empty volume — a first deploy, or a host with no PAT — is a 204, which keeps the console clean.
- **The numbers are relative to the snapshot, not to the reader's clock**: the 7-, 30- and 90-day counts and the
  13-week histogram describe the file, so they stay honest whatever its age or the browser's time zone.

`tests/e2e/kev.spec.ts` covers the rendered snapshot, opening an entry, showing all of it, the stale marker, and each
way the panel hides itself. `kev-snapshot/snapshot_test.go` covers the fetch and the transform, including that no
reader state survives it; both run in CI, the Go tests inside the image build.

## Service worker

`src/sw/service-worker.ts` is bundled by `build/serviceWorkerPlugin.ts` with esbuild into a single classic script at
`/service-worker.js`: a stable URL, with no content hash, outside Vite's module graph. Dev serves a fresh bundle per
request, so editing the worker exercises the browser's real update flow. The worker's version is `sw-<hash>`, a hash
of its own bundle; the commit SHA and build time are deliberately left out. A deploy that does not touch the worker
therefore serves identical bytes, and browsers find no update. The panel shows that version, and the strip's `BUILD`
shows the page's commit; the two are independent.

Current scope: registration, lifecycle observation, control detection, a `MessageChannel` version handshake, and a
**passive fetch observer**, all feeding one bounded, emit-ordered event log. The worker never calls `skipWaiting()` by
itself: an update waits until no page uses the old worker, or until a visitor presses **UPGRADE** in the panel.

- When an update is waiting, the page runs the version handshake with it too, and the panel shows its version. The
  button is enabled only if that worker reports `skip-waiting`. Pressing it sends `sw:skip-waiting` to the waiting
  worker, which calls `skipWaiting()` and takes over every open tab. Each tab sees `controllerchange` and repeats the
  handshake. The worker serves nothing from a cache, so a page from an older deploy keeps working under the new
  worker. Fault Lab rules lived in the old worker's memory, so each tab re-sends its own once the new controller has
  answered. If the worker has not activated after 10 s, the button can be pressed again.

The fetch listener never calls `respondWith`, so the browser performs every request exactly as it would without the
worker; responses, Resource Timing, and the strip's `EDGE` and latency bars are unaffected. It records method, URL,
destination, and mode, batches them for 50 ms, and delivers each batch only to the tab that made the requests. A
page load's own row waits in the worker until its new page exists. Status and timings come from the page's Resource
Timing rather than the worker.

- A fetch listener routes every page load through the worker. When the worker is already running the cost measured
  sub-millisecond locally; a worker woken from idle costs more. The strip's `TTFB` tooltip shows the startup time
  (`fetchStart - workerStart`) for each visit, so it is measured on real page loads rather than assumed.
- Log rows are tagged `LIFECYCLE`, `CONTROL`, or `FETCH`, and each tag can be hidden (remembered per browser). When
  the log is full, request rows are dropped before lifecycle and control history.
- `startServiceWorker()` runs at module load in `main.tsx`, so the message listener exists before the page's message
  queue opens; registration still waits for `load`, and happens in dev as well as production.
- `?sw=off` unregisters every registration for the origin and skips registering. Use it to clear a stale worker
  locally.
- Serve `/service-worker.js` with `Cache-Control: no-cache` in production. The page also registers with
  `updateViaCache: 'none'`.

`tests/e2e/service-worker.spec.ts` covers first visit (control without reload), reload (no reinstall), update (new
worker waits, old keeps control, takeover after the last tab closes), upgrading from the panel, multiple tabs, and
the kill switch. The test
server can serve a byte-different worker on demand to drive the update cases. `tests/e2e/fetch-observer.spec.ts`
covers passivity (the network answers), the page-load row, per-tab delivery, tag filtering, and eviction order.

Playwright's patched Firefox leaves a page uncontrolled after a navigation that the worker observes without
responding; real Firefox keeps it controlled, as the spec requires (checked against Developer Edition with
puppeteer-core). Tests that depend on a worker-routed navigation therefore skip the Firefox project; the rest,
including first-visit observation, run in all three engines.
