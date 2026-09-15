#!/bin/sh
#
# Smoke-test a built image the way darkflib-web.container runs it: read-only root, all capabilities dropped bar
# NET_BIND_SERVICE, uid 65532, tmpfs /data and /config. Then assert the routing, security headers, and cache policy in
# deploy/Caddyfile from outside.
#
#   DARKFLIB_IMAGE=darkflib.com:ci deploy/scripts/smoke.sh
#
# Uses podman if present, else docker (CONTAINER_ENGINE overrides). Leaves the container running when KEEP=1 so a
# browser test can reuse it; SMOKE_PORT picks the host port (default 18080).

set -eu

image=${DARKFLIB_IMAGE:-darkflib.com:ci}
port=${SMOKE_PORT:-18080}
engine=${CONTAINER_ENGINE:-$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)}
name=darkflib-smoke
base="http://127.0.0.1:$port"
failures=0

cleanup() {
    if [ "${KEEP:-0}" != 1 ]; then
        "$engine" rm --force "$name" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

"$engine" rm --force "$name" >/dev/null 2>&1 || true
"$engine" run --detach --name "$name" \
    --read-only \
    --tmpfs /data:rw,nosuid,nodev,mode=1777 \
    --tmpfs /config:rw,nosuid,nodev,mode=1777 \
    --security-opt no-new-privileges \
    --cap-drop all --cap-add NET_BIND_SERVICE \
    --user 65532:65532 \
    --pids-limit 128 \
    --publish "127.0.0.1:$port:8080" \
    "$image" >/dev/null

attempt=0
until curl --silent --fail "$base/healthz" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 50 ]; then
        echo "error: $image never answered /healthz" >&2
        "$engine" logs "$name" >&2 || true
        exit 1
    fi
    sleep 0.2
done
echo "container up and healthy on $base"

# fetch HOST PATH [curl args...] -> response headers (lower-cased names) in $headers, status in $status
fetch() {
    host=$1
    path=$2
    shift 2
    headers=$(curl --silent --output /dev/null --dump-header - --header "Host: $host" "$@" "$base$path" \
        | tr -d '\r' | awk 'NR == 1 { print; next } { i = index($0, ":"); print tolower(substr($0, 1, i - 1)) substr($0, i) }')
    status=$(printf '%s\n' "$headers" | sed -n '1s/^HTTP\/[0-9.]* \([0-9]*\).*/\1/p')
}

header() {
    printf '%s\n' "$headers" | sed -n "s/^$1: //p" | tail -n 1
}

check() {
    description=$1
    shift
    if "$@"; then
        echo "  ok    $description"
    else
        echo "  FAIL  $description" >&2
        failures=$((failures + 1))
    fi
}

is() { [ "$1" = "$2" ]; }
contains() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
lacks() { ! contains "$1" "$2"; }
one_of() {
    value=$1
    shift
    for option in "$@"; do [ "$value" = "$option" ] && return 0; done
    return 1
}

echo "darkflib.com document"
fetch darkflib.com /
check "GET / is 200" is "$status" 200
check "document revalidates (no-cache)" is "$(header cache-control)" no-cache
check "CSP is same-origin only" contains "$(header content-security-policy)" "default-src 'self'; script-src 'self'"
check "CSP forbids framing" contains "$(header content-security-policy)" "frame-ancestors 'none'"
check "HSTS set" is "$(header strict-transport-security)" "max-age=31536000"
check "nosniff" is "$(header x-content-type-options)" nosniff
check "COOP same-origin" is "$(header cross-origin-opener-policy)" same-origin
check "no Server header" is "$(header server)" ""

fetch darkflib.com / --header 'Accept-Encoding: zstd, gzip'
check "compressed for capable clients" one_of "$(header content-encoding)" zstd gzip
check "varies on Accept-Encoding" contains "$(header vary)" Accept-Encoding

echo "service worker"
fetch darkflib.com /service-worker.js
check "worker is 200" is "$status" 200
check "worker is JavaScript" contains "$(header content-type)" javascript
check "worker revalidates (no-cache)" is "$(header cache-control)" no-cache

echo "assets"
bundle=$(curl --silent --header 'Host: darkflib.com' "$base/" | sed -n 's/.*src="\(\/assets\/[^"]*\.js\)".*/\1/p' | head -n 1)
check "index.html references a hashed bundle" contains "$bundle" /assets/index-
fetch darkflib.com "$bundle"
check "bundle is 200" is "$status" 200
check "bundle is immutable" is "$(header cache-control)" "public, max-age=31536000, immutable"
fetch darkflib.com /assets/missing-deadbeef.js
check "missing bundle is 404" is "$status" 404
check "missing bundle is not cacheable" lacks "$(header cache-control)" immutable
fetch darkflib.com /images/hero-city-1672.avif
check "image is 200" is "$status" 200
check "image is AVIF" is "$(header content-type)" image/avif
check "image cached for a day" is "$(header cache-control)" "public, max-age=86400"
fetch darkflib.com /no-such-page
check "unknown path is 404" is "$status" 404

echo "names"
fetch www.darkflib.com '/deep/path?q=1'
check "www is a permanent redirect" is "$status" 301
check "www keeps path and query" is "$(header location)" 'https://darkflib.com/deep/path?q=1'
fetch darkflib.dev /lab
check "darkflib.dev is a temporary redirect" is "$status" 302
check "darkflib.dev points at the site" is "$(header location)" https://darkflib.com/lab
fetch api.darkflib.dev /
check "unused *.darkflib.dev is 404" is "$status" 404
fetch lab.darkflib.com /
check "unused *.darkflib.com is 404" is "$status" 404
fetch 127.0.0.1 /
check "direct IP access is 404" is "$status" 404

echo "container"
check "runs as uid 65532" is "$("$engine" exec "$name" id -u)" 65532
check "root filesystem is read-only" sh -c "! $engine exec $name touch /srv/www/probe 2>/dev/null"

if [ "$failures" -ne 0 ]; then
    echo "$failures check(s) failed" >&2
    "$engine" logs "$name" 2>&1 | tail -n 20 >&2 || true
    exit 1
fi
echo "all checks passed"
