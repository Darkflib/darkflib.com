# deploy/

Deployment is wwff-tech/gitops, `quadlet/apps/darkflib/`: the Quadlet units, the KEV timer, the host nginx vhost, the
secret reference, and the image pin all live there and nowhere else. Nothing in this repository touches a host. This
directory keeps only what ships in the image and what tests it.

| File               | What                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `Caddyfile`        | Baked into the image by the `Containerfile`: routing by Host, CSP and security headers, `Cache-Control`, `/healthz`, `/feeds/kev.json` off the feeds volume |
| `scripts/smoke.sh` | Runs a built image the way `darkflib-web.container` runs it (read-only, capabilities dropped, uid 65532, loopback publish) and asserts every route, header, and cache policy. Shellchecked and run in CI |

```
visitor ──TLS──▶ nginx (ny03) ──http──▶ 127.0.0.1:8082 ──▶ darkflib-web (Caddy + built site)
                 │ TLS for .darkflib.com and .darkflib.dev    │ routing by Host, security headers,
                 │ edge cache for /assets/, /images/, /feeds/ │ Cache-Control
                 │ X-Forwarded-For, Server-Timing edge status │ darkflib.network
                                                              ▲
                          darkflib-kev.timer ──hourly──▶ darkflib-kev (kev-snapshot, same image)
                                                              │ GET sretab.mikepreston.org/api/v1/feed
                                                              ▼ writes kev.json
                                                        darkflib-feeds volume (web mounts it read-only)
```

There is no application container or database: the image is Caddy with `dist/` and `deploy/Caddyfile` baked in, so
the CSP and cache policy always ship with the code they describe. The one piece of state is the KEV snapshot on the
`darkflib-feeds` volume, written by an hourly oneshot from that same image and served as `/feeds/kev.json`.

| Name                                | Served as                                              |
| ----------------------------------- | ------------------------------------------------------ |
| `darkflib.com`                      | the site                                               |
| `www.darkflib.com`                  | 301 to `https://darkflib.com`                          |
| `api.darkflib.com`                  | Fault Lab primary API: static JSON, CORS for the site  |
| `api.darkflib.dev`                  | Fault Lab secondary API (cross-site)                   |
| `media.darkflib.com`                | Fault Lab media origin                                 |
| `darkflib.com/feeds/kev.json`       | the KEV snapshot; 204 until the first refresh          |
| `darkflib.dev`, `www.darkflib.dev`  | 302 to `https://darkflib.com`                          |
| any other `*.darkflib.com` / `.dev` | 404                                                    |

## Where the rest went

| Concern                         | In wwff-tech/gitops                                                             |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Units, network, volume, timer   | `quadlet/apps/darkflib/units/`                                                  |
| nginx vhost                     | `quadlet/apps/darkflib/files/nginx.conf` (port 80 is the front door's)          |
| Host port (8082)                | `PublishPort=` in the unit                                                      |
| `SRETAB_PAT`                    | `[secrets]` in `quadlet/apps/darkflib/app.toml`, read from 1Password            |
| Installing and restarting       | `quadlet/bin/reconcile.py` on the host                                          |
| Promotion, signature check      | `quadlet/bin/promote.py`, against `quadlet/policy.toml`; reconcile verifies again before running anything |
| Pins and unit generation in CI  | `quadlet/bin/check.py` and the per-host generator dry run                       |
| Certificates                    | `certs/certs.toml` (`darkflib.com`, `darkflib.dev`) and the `certs` app         |

## Releasing

A push to main publishes `ghcr.io/darkflib/darkflib.com:sha-<commit>`, signs it with cosign (keyless), and attests
SLSA provenance and an SPDX SBOM. The workflow's `promote` job then opens the pin as a PR in wwff-tech/gitops and
merges it once that repository's checks pass; hosts pick it up on their next reconcile. It needs the `GITOPS_TOKEN`
secret (contents and pull-requests write on wwff-tech/gitops) and fails saying so without it. Like publishing, it only
runs while this repository is public.

To promote by hand (the fallback if that job fails), from a wwff-tech/gitops checkout:

```sh
python3 quadlet/bin/promote.py darkflib ghcr.io/darkflib/darkflib.com sha-<commit> --pr
```

Rolling back is the same command with an older commit. If a bad service worker is the problem, visiting
`https://darkflib.com/?sw=off` unregisters it in that browser.

## The KEV snapshot

`/feeds/kev.json` is CISA's Known Exploited Vulnerabilities catalogue as sre-tab carries it, copied here so the page
can render it without a credential in the browser and without visitors reaching sre-tab at all. `darkflib-kev.timer`
runs `kev-snapshot` (in the site's own image) hourly; it pages through
`sretab.mikepreston.org/api/v1/feed?sources=cisa-kev`, keeps only the public fields — never the token owner's read or
bookmark state — and replaces the file on the `darkflib-feeds` volume atomically. `darkflib-web` mounts that volume
read-only, and only `darkflib-kev` receives the token, so the internet-facing container holds no credential.

A failed refresh leaves the previous snapshot in place and the unit in a failed state; the panel shows the
snapshot's age, marks it stale after three hours, and hides itself after a week.

## What CI proves

The `container` job builds the image and then:

- checks the image has a healthcheck, runs as uid 65532, and contains no setuid files
- runs `scripts/smoke.sh`: every route, security header, cache policy, and hardening flag above, against the container
  started the way the Quadlet starts it
- loads the site in Chromium under the real headers, with no CSP violations and the service worker in control

`publish` then pushes that exact image, signs it, and attests it. It runs only for pushes to main on a public
repository. Unit generation, digest pins, and signature verification are gitops' checks, not this repository's.
