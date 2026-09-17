# Deploying darkflib.com

Runs on ny03.technomonk.net beside orbit-data and sre-tab, following their pattern: rootful Podman Quadlets, Caddy
as the inner web server, and host nginx for TLS and the edge cache.

```
visitor ──TLS──▶ nginx (ny03) ──http──▶ 127.0.0.1:8082 ──▶ darkflib-web (Caddy + built site)
                 │ TLS for .darkflib.com and .darkflib.dev    │ routing by Host, security headers,
                 │ edge cache for /assets/, /images/, /feeds/ │ Cache-Control
                 │ X-Forwarded-For, Server-Timing edge status │ darkflib.network 10.89.62.0/24
                                                              ▲
                          darkflib-kev.timer ──hourly──▶ darkflib-kev (kev-snapshot, same image)
                                                              │ GET sretab.mikepreston.org/api/v1/feed
                                                              ▼ writes kev.json
                                                        darkflib-feeds volume (web mounts it read-only)
```

There is no application container or database: the image is Caddy with `dist/` and `deploy/Caddyfile` baked in, so
the CSP and cache policy always ship with the code they describe. The one piece of state is the KEV snapshot on the
`darkflib-feeds` volume, written by a hourly oneshot from that same image and served as `/feeds/kev.json`.

| Name                                | Served as                                                    |
| ----------------------------------- | ------------------------------------------------------------ |
| `darkflib.com`                      | the site                                                     |
| `www.darkflib.com`                  | 301 to `https://darkflib.com`                                |
| `api.darkflib.com`                  | Fault Lab primary API: static JSON, CORS for the site        |
| `api.darkflib.dev`                  | Fault Lab secondary API (cross-site)                         |
| `media.darkflib.com`                | Fault Lab media origin                                       |
| `darkflib.com/feeds/kev.json`       | the KEV snapshot; 204 until the first refresh                 |
| `darkflib.dev`, `www.darkflib.dev`  | 302 to `https://darkflib.com`                                |
| any other `*.darkflib.com` / `.dev` | 404                                                          |

Host port 8082 comes from `~/dev/backend-allocations.md`.

## Files

| Repository                         | Installed to                                      | Notes                                              |
| ---------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| `quadlet/darkflib.network`         | `/etc/containers/systemd/`                        | 10.89.62.0/24; gateway is Caddy's trusted proxy    |
| `quadlet/darkflib-web.container`   | `/etc/containers/systemd/`                        | `Image=` pinned by digest via `promote.sh`         |
| `quadlet/darkflib-kev.container`   | `/etc/containers/systemd/`                        | oneshot KEV fetch; same `Image=` pin               |
| `quadlet/darkflib-feeds.volume`    | `/etc/containers/systemd/`                        | snapshot volume, owned by uid 65532                |
| `systemd/darkflib-kev.timer`       | `/etc/systemd/system/`                            | hourly at :37 UTC, five minutes of jitter          |
| `install.env.example`              | `/etc/darkflib/install.env.example`               | copy to `install.env` (mode 0600); set `DARKFLIB_WEB_PORT=8082` and `SRETAB_PAT` |
| (generated)                        | `/etc/containers/systemd/darkflib-web.container.d/` | port drop-in written by `install.sh`             |
| `nginx/darkflib.conf`              | `/etc/nginx/conf.d/` (with `--nginx`)             | upstream port must match `DARKFLIB_WEB_PORT`       |
| `Caddyfile`                        | inside the image                                  | not installed on the host                          |
| certbot `live/darkflib.{com,dev}/` | `/etc/nginx/certs/darkflib.{com,dev}/`            | copied by `scripts/push-certs.sh` from the certbot host |

## First deployment

1. **Certificates.** Two certbot certificates, issued off-host with the Vultr DNS-01 authenticator (wildcards need
   DNS-01) and copied to ny03. Two rather than one because adding names to an existing certificate needs `--expand`;
   a separate `darkflib.dev` certificate works with an unchanged `certbot certonly -d "$CERTBOT_DOMAINS"`:

   | Certificate name | Domains                          | On ny03                          |
   | ---------------- | -------------------------------- | -------------------------------- |
   | `darkflib.com`   | `darkflib.com`, `*.darkflib.com` | `/etc/nginx/certs/darkflib.com/` |
   | `darkflib.dev`   | `darkflib.dev`, `*.darkflib.dev` | `/etc/nginx/certs/darkflib.dev/` |

   Both zones must be served by Vultr DNS for the authenticator to answer the challenge. On the certbot host:

   ```sh
   CERTBOT_DOMAINS='darkflib.com,*.darkflib.com' docker compose --profile tools run --rm certbot
   CERTBOT_DOMAINS='darkflib.dev,*.darkflib.dev' docker compose --profile tools run --rm certbot
   ```

   Then copy them with `deploy/scripts/push-certs.sh` (see [Certificate renewal](#certificate-renewal)).

   Also confirm `/etc/nginx/snippets/tls-modern-mozilla.conf` exists on ny03. If it sets HSTS, browsers will receive
   that header twice, because Caddy also sets `max-age=31536000`. The values agree, so this is harmless.

2. **Publish and promote.** A push to main publishes `ghcr.io/darkflib/darkflib.com:sha-<commit>`, then signs and
   attests it. The GHCR package must be public so ny03 can pull it without credentials. Pin the build from a checkout:

   ```sh
   deploy/scripts/promote.sh            # verifies the signature, then rewrites Image=
   git commit -am 'deploy: promote sha-…' && git push
   ```

3. **Install on ny03**, from a checkout of that commit:

   ```sh
   sudo install -d -m 0755 /etc/darkflib
   sudo install -m 0600 deploy/install.env.example /etc/darkflib/install.env
   sudo sed -i 's/^#DARKFLIB_WEB_PORT=.*/DARKFLIB_WEB_PORT=8082/' /etc/darkflib/install.env
   sudo "$EDITOR" /etc/darkflib/install.env   # SRETAB_PAT=…, see "The KEV snapshot"
   ss -lntp | grep ':8082 '             # must print nothing
   sudo deploy/install.sh --start --nginx
   ```

4. **Check it**:

   ```sh
   systemctl status darkflib-web.service
   curl -sI -H 'Host: darkflib.com' http://127.0.0.1:8082/ | grep -i content-security-policy
   curl -sI https://darkflib.com/assets/ | grep -i server-timing
   ```

## Upgrading

```sh
deploy/scripts/promote.sh && git commit -am 'deploy: promote …' && git push   # anywhere
git pull && sudo deploy/install.sh --start                                     # on ny03
```

Visitors keep receiving cached `/assets/` and `/images/` from nginx during the restart (`proxy_cache_use_stale`).
Service-worker updates follow the browser's normal lifecycle: the new worker waits until the old site's tabs close.

## The KEV snapshot

`/feeds/kev.json` is CISA's Known Exploited Vulnerabilities catalogue as sre-tab carries it, copied here so the page
can render it without a credential in the browser and without visitors reaching sre-tab at all. `darkflib-kev.timer`
runs `kev-snapshot` (in the site's own image) hourly at :37 UTC; it pages through
`sretab.mikepreston.org/api/v1/feed?sources=cisa-kev`, keeps only the public fields — never the token owner's read or
bookmark state — and replaces the file on the `darkflib-feeds` volume atomically. `darkflib-web` mounts that volume
read-only.

The credential is a personal access token from sre-tab, read-only scope, set as `SRETAB_PAT` in
`/etc/darkflib/install.env`. Because that file then holds a secret, the installer refuses to read it unless it is
root's and mode 0600 (or 0400), and every run copies the value into the Podman secret `darkflib-sretab-pat` — which
only `darkflib-kev.container` receives, so the internet-facing container holds no credential. Rotating the token is
an edit and a re-run; no restart is needed, since the next refresh picks it up.

```sh
systemctl list-timers darkflib-kev.timer
systemctl start darkflib-kev.service && journalctl -u darkflib-kev.service -n 5   # refresh now
curl -s -H 'Host: darkflib.com' http://127.0.0.1:8082/feeds/kev.json | head -c 200
```

A failed refresh leaves the previous snapshot in place and the unit in a failed state (`systemctl --failed`); the
panel shows the snapshot's age, marks it stale after three hours, and hides itself after a week. Unsetting
`SRETAB_PAT` and re-running the installer removes the secret and disables the timer, which is how the panel is turned
off; the volume keeps the last snapshot until it ages out of the page.

## Certificate renewal

Certificates are issued off-host and copied by hand until they move to 1Password or Vault. That makes expiry the
likeliest outage this deployment has: Let's Encrypt certificates last 90 days, and certbot renews them with 30 days
left on the certbot host, where nginx on ny03 cannot see the renewal. After each renewal, from the certbot host:

```sh
deploy/scripts/push-certs.sh ny03.technomonk.net /path/to/letsencrypt
```

It dereferences certbot's `live/` symlinks, installs both certificates (key `0600 root`), refuses a certificate whose
names or key pairing are wrong, and reloads nginx only after `nginx -t` passes. To see what ny03 is actually serving:

```sh
for name in darkflib.com darkflib.dev; do
  echo | openssl s_client -connect ny03.technomonk.net:443 -servername "$name" 2>/dev/null \
    | openssl x509 -noout -subject -enddate
done
```

## Rolling back

Promote the previous digest (`deploy/scripts/promote.sh <older commit>`), commit, and repeat the install. If a bad
service worker is the problem, visiting `https://darkflib.com/?sw=off` unregisters it in that browser.

## What CI proves

The `container` job builds the image and then:

- checks the image has a healthcheck, runs as uid 65532, and contains no setuid files
- runs `scripts/smoke.sh`: every route, security header, cache policy, and hardening flag above, against the container
  started the way the Quadlet starts it
- loads the site in Chromium under the real headers, with no CSP violations and the service worker in control
- runs `scripts/check-quadlets.sh` and `scripts/check-nginx.sh` on Debian 13 with podman 5.4.2 and nginx 1.26: unit
  generation with the 8082 drop-in and an `SRETAB_PAT`, the installer's refusal to read a credential out of a
  world-readable `install.env`, and `nginx -t`

`publish` then pushes that exact image, signs it with cosign (keyless), and attests SLSA provenance and an SPDX SBOM.
It runs only for pushes to main on a public repository. Nothing verifies the signature at container start, since
Podman's signature policy cannot express a GitHub Actions identity; `promote.sh` and CI are the enforcement points.
