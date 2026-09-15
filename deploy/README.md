# Deploying darkflib.com

Runs on ny03.technomonk.net beside orbit-data and sre-tab, following their pattern: rootful Podman Quadlets, Caddy
as the inner web server, and host nginx for TLS and the edge cache.

```
visitor ──TLS──▶ nginx (ny03) ──http──▶ 127.0.0.1:8082 ──▶ darkflib-web (Caddy + built site)
                 │ TLS for .darkflib.com and .darkflib.dev    │ routing by Host, security headers,
                 │ edge cache for /assets/ and /images/       │ Cache-Control
                 │ X-Forwarded-For, Server-Timing edge status │ darkflib.network 10.89.62.0/24
```

There is no application container or database: the image is Caddy with `dist/` and `deploy/Caddyfile` baked in, so
the CSP and cache policy always ship with the code they describe.

| Name                                | Served as                                                    |
| ----------------------------------- | ------------------------------------------------------------ |
| `darkflib.com`                      | the site                                                     |
| `www.darkflib.com`                  | 301 to `https://darkflib.com`                                |
| `darkflib.dev`, `www.darkflib.dev`  | 302 to `https://darkflib.com`, until the Fault Lab uses them |
| any other `*.darkflib.com` / `.dev` | 404 (reserved for Fault Lab origins)                         |

Host port 8082 comes from `~/dev/backend-allocations.md`.

## Files

| Repository                         | Installed to                                      | Notes                                              |
| ---------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| `quadlet/darkflib.network`         | `/etc/containers/systemd/`                        | 10.89.62.0/24; gateway is Caddy's trusted proxy    |
| `quadlet/darkflib-web.container`   | `/etc/containers/systemd/`                        | `Image=` pinned by digest via `promote.sh`         |
| `install.env.example`              | `/etc/darkflib/install.env.example`               | copy to `install.env`; set `DARKFLIB_WEB_PORT=8082` |
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
   sudo install -m 0644 deploy/install.env.example /etc/darkflib/install.env
   sudo sed -i 's/^#DARKFLIB_WEB_PORT=.*/DARKFLIB_WEB_PORT=8082/' /etc/darkflib/install.env
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
  generation with the 8082 drop-in, and `nginx -t`

`publish` then pushes that exact image, signs it with cosign (keyless), and attests SLSA provenance and an SPDX SBOM.
It runs only for pushes to main on a public repository. Nothing verifies the signature at container start, since
Podman's signature policy cannot express a GitHub Actions identity; `promote.sh` and CI are the enforcement points.
