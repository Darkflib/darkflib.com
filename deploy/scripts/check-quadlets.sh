#!/bin/sh
#
# Generate the systemd units from deploy/quadlet exactly as ny03 will, via install.sh staged with the host's port
# override, and assert the result. Quadlets cannot be generated on macOS; CI runs this inside Debian 13 (the podman
# ny03 runs).
#
#   deploy/scripts/check-quadlets.sh

set -eu

generator=/usr/lib/systemd/system-generators/podman-system-generator
[ -x "$generator" ] || generator=/usr/libexec/podman/quadlet
[ -x "$generator" ] || { echo "error: podman's Quadlet generator is not installed" >&2; exit 1; }

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
stage=$(mktemp -d "${TMPDIR:-/tmp}/darkflib-quadlet.XXXXXX")
trap 'rm -rf "$stage"' EXIT

mkdir -p "$stage/etc/darkflib"
printf 'DARKFLIB_WEB_PORT=8082\n' > "$stage/etc/darkflib/install.env"
DESTDIR="$stage" "$script_dir/../install.sh" --nginx

out="$stage/generated"
QUADLET_UNIT_DIRS="$stage/etc/containers/systemd" "$generator" --dryrun > "$out"

failures=0
if [ -d "$stage/var/cache/nginx" ]; then
    echo "  ok    installer creates the nginx cache parent (/var/cache/nginx)"
else
    echo "  FAIL  installer does not create /var/cache/nginx; nginx -t fails on Debian's nginx" >&2
    failures=$((failures + 1))
fi
expect() {
    if grep -q -- "$1" "$out"; then echo "  ok    $2"; else echo "  FAIL  $2" >&2; failures=$((failures + 1)); fi
}
refuse() {
    if grep -q -- "$1" "$out"; then echo "  FAIL  $2" >&2; failures=$((failures + 1)); else echo "  ok    $2"; fi
}

expect '---darkflib-web.service---' "darkflib-web.service generated"
expect '---darkflib-network.service---' "darkflib-network.service generated"
expect '--publish 127.0.0.1:8082:8080' "publishes the host policy port"
refuse '--publish 127.0.0.1:8080:8080' "does not also publish the default port"
expect '--read-only' "read-only root filesystem"
expect '--cap-drop all' "drops all capabilities"
expect '--health-on-failure\|--sdnotify=healthy' "waits on the image healthcheck"
expect '--network systemd-darkflib' "joins darkflib.network"

if [ "$failures" -ne 0 ]; then
    echo "--- generated units:" >&2
    cat "$out" >&2
    exit 1
fi
echo "quadlets generate cleanly"
