#!/bin/sh
#
# Copy the darkflib.com and darkflib.dev certbot certificates to a host and reload its nginx.
#
#   deploy/scripts/push-certs.sh [--check] HOST LETSENCRYPT_DIR
#   deploy/scripts/push-certs.sh ny03.technomonk.net ./letsencrypt
#
# Interim tooling until certificates live in 1Password or Vault. Run on the certbot host after issuance or renewal.
#
# Before anything leaves this machine, each certificate is checked: both names present (apex and wildcard), not
# expiring within a day, and the private key matching the certificate. certbot's live/ entries are symlinks into
# archive/, so they are dereferenced. The keys are usually root-owned, so they are read through sudo when necessary and
# staged in a private temporary directory.
#
# On the host (via sudo): the previous pair is kept, the new pair installed (key 0600 root), and nginx reloaded only if
# `nginx -t` passes; otherwise the previous pair is restored. --check stops after local validation.

set -eu

NAMES="darkflib.com darkflib.dev"

check_only=false
if [ "${1:-}" = --check ]; then
    check_only=true
    shift
fi
[ "$#" -eq 2 ] || { echo "usage: deploy/scripts/push-certs.sh [--check] HOST LETSENCRYPT_DIR" >&2; exit 2; }
host=$1
live="$2/live"

stage=$(mktemp -d "${TMPDIR:-/tmp}/darkflib-certs.XXXXXX")
trap 'rm -rf "$stage"' EXIT
chmod 0700 "$stage"

# Dereferenced copy, owned by this user, via sudo only if the keys are not readable as-is.
read_live() {
    if [ -r "$live/darkflib.com/privkey.pem" ] && [ -r "$live/darkflib.dev/privkey.pem" ]; then
        tar -chf - -C "$live" darkflib.com darkflib.dev
    else
        sudo tar -chf - -C "$live" darkflib.com darkflib.dev
    fi
}
(umask 077 && read_live | tar -xf - -C "$stage")

failures=0
for name in $NAMES; do
    before=$failures
    cert="$stage/$name/fullchain.pem"
    key="$stage/$name/privkey.pem"
    if [ ! -s "$cert" ] || [ ! -s "$key" ]; then
        echo "  FAIL  $name: fullchain.pem or privkey.pem missing under $live/$name" >&2
        failures=$((failures + 1))
        continue
    fi
    sans=$(openssl x509 -in "$cert" -noout -text | tr ',' '\n' | sed -n 's/^ *DNS://p')
    for want in "$name" "*.$name"; do
        if ! printf '%s\n' "$sans" | grep -qxF -- "$want"; then
            echo "  FAIL  $name: certificate does not cover $want (has: $(printf '%s ' "$sans"))" >&2
            failures=$((failures + 1))
        fi
    done
    if ! openssl x509 -in "$cert" -noout -checkend 86400 >/dev/null; then
        echo "  FAIL  $name: certificate expires within 24 hours" >&2
        failures=$((failures + 1))
    fi
    # pkey reads RSA and EC keys alike; x509 -pubkey prints the certificate's public key.
    cert_hash=$(openssl x509 -in "$cert" -noout -pubkey | openssl sha256 | sed 's/.*= *//')
    key_hash=$(openssl pkey -in "$key" -pubout 2>/dev/null | openssl sha256 | sed 's/.*= *//')
    if [ "$cert_hash" != "$key_hash" ]; then
        echo "  FAIL  $name: private key does not match the certificate" >&2
        failures=$((failures + 1))
    fi
    [ "$failures" -ne "$before" ] || echo "  ok    $name: $(openssl x509 -in "$cert" -noout -enddate)"
done
[ "$failures" -eq 0 ] || { echo "$failures problem(s); nothing copied" >&2; exit 1; }

if [ "$check_only" = true ]; then
    echo "certificates valid; --check, so nothing copied"
    exit 0
fi

cat > "$stage/apply.sh" <<'EOF'
#!/bin/sh
set -eu
src=$(dirname "$0")
names="darkflib.com darkflib.dev"
install -d -m 0755 /etc/nginx/certs
for name in $names; do
    dest=/etc/nginx/certs/$name
    install -d -m 0750 "$dest"
    for file in fullchain.pem privkey.pem; do
        [ ! -f "$dest/$file" ] || cp -p "$dest/$file" "$dest/$file.previous"
    done
    install -m 0644 "$src/$name/fullchain.pem" "$dest/fullchain.pem"
    install -m 0600 "$src/$name/privkey.pem" "$dest/privkey.pem"
done
if nginx -t; then
    systemctl reload nginx
    rm -f /etc/nginx/certs/darkflib.com/*.previous /etc/nginx/certs/darkflib.dev/*.previous
    echo "certificates installed and nginx reloaded"
else
    echo "nginx -t failed; restoring the previous certificates" >&2
    for name in $names; do
        for file in fullchain.pem privkey.pem; do
            [ ! -f "/etc/nginx/certs/$name/$file.previous" ] || mv "/etc/nginx/certs/$name/$file.previous" "/etc/nginx/certs/$name/$file"
        done
    done
    exit 1
fi
EOF

remote=$(ssh "$host" 'mktemp -d /tmp/darkflib-certs.XXXXXX')
# shellcheck disable=SC2029 # $remote is deliberately expanded locally
tar -cf - -C "$stage" darkflib.com darkflib.dev apply.sh | ssh "$host" "umask 077 && tar -xf - -C '$remote'"
# -t so sudo can prompt; the remote staging directory is removed whether or not the apply succeeds.
# shellcheck disable=SC2029
ssh -t "$host" "sudo sh '$remote/apply.sh'; status=\$?; rm -rf '$remote'; exit \$status"
