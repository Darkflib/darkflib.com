#!/bin/sh
#
# Validate deploy/nginx/darkflib.conf with `nginx -t` off-host. The vhost names host paths that do not exist here (the
# lego certificate, the shared TLS snippet, the cache directory), so this stages a throwaway prefix with a self-signed
# certificate and a stub snippet, rewrites only those paths and the listen ports, and tests the result. Everything
# else, including the upstream, cache, and header directives, is tested verbatim.

set -eu

command -v nginx >/dev/null 2>&1 || { echo "error: nginx is not installed" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "error: openssl is not installed" >&2; exit 1; }

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
prefix=$(mktemp -d "${TMPDIR:-/tmp}/darkflib-nginx.XXXXXX")
trap 'rm -rf "$prefix"' EXIT
mkdir -p "$prefix/conf" "$prefix/logs" "$prefix/cache" "$prefix/certs"

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=darkflib.com" \
    -keyout "$prefix/certs/privkey.pem" -out "$prefix/certs/fullchain.pem" 2>/dev/null
printf 'ssl_protocols TLSv1.2 TLSv1.3;\n' > "$prefix/conf/tls-snippet.conf"

sed -e "s#/var/cache/nginx/darkflib#$prefix/cache#" \
    -e "s#/etc/nginx/certs/darkflib.com#$prefix/certs#g" \
    -e "s#/etc/nginx/snippets/tls-modern-mozilla.conf#$prefix/conf/tls-snippet.conf#" \
    -e 's#listen 443 ssl;#listen 127.0.0.1:18443 ssl;#' \
    -e 's#listen \[::\]:443 ssl;##' \
    -e 's#listen 80;#listen 127.0.0.1:18081;#' \
    -e 's#listen \[::\]:80;##' \
    "$script_dir/../nginx/darkflib.conf" > "$prefix/conf/darkflib.conf"

cat > "$prefix/conf/nginx.conf" <<EOF
worker_processes 1;
error_log $prefix/logs/error.log;
pid $prefix/logs/nginx.pid;
events { worker_connections 16; }
http {
    access_log off;
    client_body_temp_path $prefix/cache/body;
    proxy_temp_path $prefix/cache/proxy;
    fastcgi_temp_path $prefix/cache/fastcgi;
    uwsgi_temp_path $prefix/cache/uwsgi;
    scgi_temp_path $prefix/cache/scgi;
    include $prefix/conf/darkflib.conf;
}
EOF

nginx -t -p "$prefix" -c "$prefix/conf/nginx.conf"
