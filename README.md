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
| `src/content.ts`                | Placeholder content from the mockup, pending real material                  |
| `src/sw/`                       | Service worker entry and the page↔worker message protocol                   |
| `src/telemetry/`                | Page-side telemetry sources, including the service worker store             |
| `build/`                        | Vite plugin that bundles the worker; build metadata                         |
| `tests/e2e/`, `tests/support/`  | Playwright specs and a per-worker static server for `dist/`                 |
| `assets/source/`                | PNG masters for generated imagery (not shipped)                             |
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
| `UTC`     | Wall clock                                                                                     |
| Bars      | Resource Timing for the last 62 subresource requests: log-scaled, dim when cached, magenta ≥ 800 ms |

The bars will pick up Fault Lab latency injection with no extra wiring, since injected delays show up in Resource
Timing. The slogan on the right is just decoration.

## Service worker

`src/sw/service-worker.ts` is bundled by `build/serviceWorkerPlugin.ts` with esbuild into a single classic script at
`/service-worker.js`: a stable URL, with no content hash, outside Vite's module graph. Dev serves a fresh bundle per
request, so editing the worker exercises the browser's real update flow. The worker reports its build as
`<sha>[-dirty]+<bundle hash>`; unchanged source produces identical bytes, so rebuilds never cause spurious updates.

Current scope is v0: registration, lifecycle observation, control detection, a `MessageChannel` version handshake,
and a bounded, emit-ordered event log. There is no `fetch` listener, so nothing is intercepted. There is deliberately
no `skipWaiting()`: an update waits until no page uses the old worker.

- Registration happens after `load` and in dev as well as production.
- `?sw=off` unregisters every registration for the origin and skips registering. Use it to clear a stale worker
  locally.
- Serve `/service-worker.js` with `Cache-Control: no-cache` in production. The page also registers with
  `updateViaCache: 'none'`.

`tests/e2e/service-worker.spec.ts` covers first visit (control without reload), reload (no reinstall), update (new
worker waits, old keeps control, takeover after the last tab closes), multiple tabs, and the kill switch. The test
server can serve a byte-different worker on demand to drive the update cases.
