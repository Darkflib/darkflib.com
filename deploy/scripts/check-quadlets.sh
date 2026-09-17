#!/bin/sh
#
# Generate the systemd units from deploy/quadlet exactly as ny03 will, via install.sh staged with the host's port
# override and an sre-tab PAT, and assert the result. Quadlets cannot be generated on macOS; CI runs this inside
# Debian 13 (the podman ny03 runs).
#
#   deploy/scripts/check-quadlets.sh

set -eu

generator=/usr/lib/systemd/system-generators/podman-system-generator
[ -x "$generator" ] || generator=/usr/libexec/podman/quadlet
[ -x "$generator" ] || { echo "error: podman's Quadlet generator is not installed" >&2; exit 1; }

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
stage=$(mktemp -d "${TMPDIR:-/tmp}/darkflib-quadlet.XXXXXX")
trap 'rm -rf "$stage"' EXIT

failures=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1" >&2; failures=$((failures + 1)); }

mkdir -p "$stage/etc/darkflib"
install_env="$stage/etc/darkflib/install.env"
pat=sretab_pat_check-quadlets-not-a-real-token

# A PAT in a file others can read is refused before anything is written.
printf 'DARKFLIB_WEB_PORT=8082\nSRETAB_PAT=%s\n' "$pat" > "$install_env"
chmod 0644 "$install_env"
if DESTDIR="$stage" "$script_dir/../install.sh" > "$stage/refused.log" 2>&1; then
    fail "installer accepts SRETAB_PAT in a world-readable install.env"
elif [ -e "$stage/etc/containers" ] || grep -q -- "$pat" "$stage/refused.log"; then
    fail "installer wrote files or printed the token before refusing a world-readable install.env"
else
    pass "installer refuses SRETAB_PAT in a world-readable install.env, and writes nothing"
fi

printf 'SRETAB_PAT="has a space"\n' > "$install_env"
chmod 0600 "$install_env"
if DESTDIR="$stage" "$script_dir/../install.sh" > /dev/null 2>&1; then
    fail "installer accepts an SRETAB_PAT containing whitespace"
else
    pass "installer refuses an SRETAB_PAT containing whitespace"
fi

printf 'DARKFLIB_WEB_PORT=8082\nSRETAB_PAT="%s"\n' "$pat" > "$install_env"
chmod 0600 "$install_env"
DESTDIR="$stage" "$script_dir/../install.sh" --nginx > "$stage/install.log"
if grep -q -- "$pat" "$stage/install.log"; then
    fail "installer printed the token"
else
    pass "installer does not print the token"
fi

out="$stage/generated"
QUADLET_UNIT_DIRS="$stage/etc/containers/systemd" "$generator" --dryrun > "$out"

if [ -d "$stage/var/cache/nginx" ]; then
    pass "installer creates the nginx cache parent (/var/cache/nginx)"
else
    fail "installer does not create /var/cache/nginx; nginx -t fails on Debian's nginx"
fi
if [ -f "$stage/etc/systemd/system/darkflib-kev.timer" ]; then
    pass "installer stages darkflib-kev.timer as a native unit"
else
    fail "installer does not stage darkflib-kev.timer"
fi
expect() {
    if grep -q -- "$1" "$out"; then pass "$2"; else fail "$2"; fi
}
refuse() {
    if grep -q -- "$1" "$out"; then fail "$2"; else pass "$2"; fi
}
# section UNIT: the generated unit's text, as the generator's --dryrun prints it
section() {
    awk -v unit="---$1---" '/^---.*---$/ { on = ($0 == unit); next } on' "$out"
}

expect '---darkflib-web.service---' "darkflib-web.service generated"
expect '---darkflib-network.service---' "darkflib-network.service generated"
expect '--publish 127.0.0.1:8082:8080' "publishes the host policy port"
refuse '--publish 127.0.0.1:8080:8080' "does not also publish the default port"
expect '--read-only' "read-only root filesystem"
expect '--cap-drop all' "drops all capabilities"
expect '--health-on-failure\|--sdnotify=healthy' "waits on the image healthcheck"
expect '--network systemd-darkflib' "joins darkflib.network"

expect '---darkflib-feeds-volume.service---' "darkflib-feeds-volume.service generated"
expect 'volume create --ignore --opt o=uid=65532,gid=65532 systemd-darkflib-feeds' "feeds volume is owned by uid 65532"
web=$(section darkflib-web.service)
kev=$(section darkflib-kev.service)
case $web in
    *'-v systemd-darkflib-feeds:/srv/feeds:ro'*) pass "darkflib-web mounts the feeds volume read-only" ;;
    *) fail "darkflib-web does not mount the feeds volume read-only" ;;
esac
case $web in
    *darkflib-sretab-pat*) fail "darkflib-web receives the sre-tab PAT" ;;
    *) pass "darkflib-web does not receive the sre-tab PAT" ;;
esac
case $kev in
    '') fail "darkflib-kev.service generated" ;;
    *) pass "darkflib-kev.service generated" ;;
esac
for fragment in \
    '--secret darkflib-sretab-pat,type=env,target=SRETAB_PAT' \
    '-v systemd-darkflib-feeds:/srv/feeds ' \
    '/usr/local/bin/kev-snapshot -out /srv/feeds' \
    '--health-cmd none' \
    '--read-only' \
    '--cap-drop all' \
    '--user 65532:65532' \
    'Type=oneshot'; do
    case $kev in
        *"$fragment"*) pass "darkflib-kev: $fragment" ;;
        *) fail "darkflib-kev lacks $fragment" ;;
    esac
done
case $kev in
    *--publish*|*--cap-add*) fail "darkflib-kev publishes a port or adds a capability" ;;
    *) pass "darkflib-kev publishes nothing and adds no capability" ;;
esac

if [ "$failures" -ne 0 ]; then
    echo "--- generated units:" >&2
    cat "$out" >&2
    exit 1
fi
echo "quadlets generate cleanly"
