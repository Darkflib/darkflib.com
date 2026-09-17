#!/bin/sh
#
# Install the darkflib.com Quadlets, the KEV snapshot timer, and, optionally, the host nginx vhost. Mirrors sre-tab's
# installer: idempotent, rootful, DESTDIR-stageable, and host policy read from /etc/darkflib/install.env rather than
# edited into tracked files.

set -eu

usage() {
    cat <<'EOF'
Usage: deploy/install.sh [--start] [--nginx]

  --start  Restart darkflib-network, darkflib-feeds-volume, and darkflib-web in one transaction, adopting changed
           units and a newly promoted image. With SRETAB_PAT set, also enable darkflib-kev.timer and refresh the KEV
           snapshot once; without it, disable the timer.
  --nginx  Also install deploy/nginx/darkflib.conf to /etc/nginx/conf.d, test with `nginx -t`, and reload. The
           previous vhost is restored if the test fails.

Tracked files are replaced on every run. Host policy lives in /etc/darkflib/install.env, which this script reads but
never writes: set DARKFLIB_WEB_PORT there to publish somewhere other than 127.0.0.1:8080 (ny03 uses 8082), and
SRETAB_PAT to feed the KEV panel. Every run loads SRETAB_PAT into the podman secret darkflib-sretab-pat, or removes
that secret and disables the timer when it is unset.
EOF
}

start_services=false
install_nginx=false
for arg in "$@"; do
    case "$arg" in
        --start) start_services=true ;;
        --nginx) install_nginx=true ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage >&2
            exit 2
            ;;
    esac
done

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
install_root=${DESTDIR:-}

if [ -n "$install_root" ]; then
    if [ "$start_services" = true ]; then
        echo "error: --start cannot be used with DESTDIR" >&2
        exit 2
    fi
elif [ "$(id -u)" -ne 0 ]; then
    echo "error: run this installer as root" >&2
    exit 1
fi

quadlet_dir="$install_root/etc/containers/systemd"
systemd_dir="$install_root/etc/systemd/system"
config_dir="$install_root/etc/darkflib"
nginx_dir="$install_root/etc/nginx/conf.d"

# --- Published host port ---------------------------------------------------------------------------------------------
# Validated before anything is written, so a bad value leaves the host untouched. Read as a table of values, never
# sourced; the last assignment wins, as in a systemd EnvironmentFile.
web_port=8080
web_port_set=false
install_env="$config_dir/install.env"

if [ -f "$install_env" ]; then
    # The x prefix separates "assigned nothing" (an error) from "not mentioned" (the default).
    raw=$(sed -n 's/^[[:space:]]*DARKFLIB_WEB_PORT=/x/p' "$install_env" | tail -n 1)
    if [ -n "$raw" ]; then
        web_port_set=true
        web_port=${raw#x}
        case $web_port in
            '"'*'"') web_port=${web_port#'"'}; web_port=${web_port%'"'} ;;
            "'"*"'") web_port=${web_port#"'"}; web_port=${web_port%"'"} ;;
        esac
    fi
fi

if [ "$web_port_set" = true ]; then
    ok=true
    case $web_port in
        '' | *[!0-9]* | 0*) ok=false ;;
    esac
    # Length before magnitude: test -gt on a very long string is undefined, not false.
    if [ "$ok" = true ] && { [ "${#web_port}" -gt 5 ] || [ "$web_port" -gt 65535 ]; }; then
        ok=false
    fi
    if [ "$ok" != true ]; then
        echo "error: DARKFLIB_WEB_PORT in $install_env is '$web_port', not a port from 1 to 65535." >&2
        echo "       Nothing has been installed or changed." >&2
        exit 2
    fi
    if [ "$web_port" -lt 1024 ]; then
        echo "warning: DARKFLIB_WEB_PORT=$web_port is privileged; host listeners (nginx included) live down there." >&2
    fi
fi

# --- sre-tab PAT -----------------------------------------------------------------------------------------------------
# The one credential install.env may hold, read the same way as the port and never echoed. An empty assignment is the
# same as none: no KEV feed. Checked before anything is written, like the port.
sretab_pat=
secret_name=darkflib-sretab-pat

if [ -f "$install_env" ]; then
    # Through pipes only, never an argument, so the token does not appear in any process's argv.
    raw=$(sed -n 's/^[[:space:]]*SRETAB_PAT=/x/p' "$install_env" | tail -n 1)
    sretab_pat=${raw#x}
    case $sretab_pat in
        '"'*'"') sretab_pat=${sretab_pat#'"'}; sretab_pat=${sretab_pat%'"'} ;;
        "'"*"'") sretab_pat=${sretab_pat#"'"}; sretab_pat=${sretab_pat%"'"} ;;
    esac
fi

if [ -n "$sretab_pat" ]; then
    case $sretab_pat in
        *[![:graph:]]*)
            echo "error: SRETAB_PAT in $install_env contains whitespace or control characters." >&2
            echo "       Nothing has been installed or changed." >&2
            exit 2
            ;;
    esac
    # A file holding a credential must be root's alone. POSIX find, so no GNU-only -perm /mode.
    loose=$(find "$install_env" -prune \( -perm -g=r -o -perm -g=w -o -perm -o=r -o -perm -o=w \) -print)
    if [ -n "$loose" ]; then
        echo "error: $install_env holds SRETAB_PAT, but users other than its owner can read or write it." >&2
        echo "       sudo chmod 600 $install_env, then re-run. Nothing has been installed or changed." >&2
        exit 2
    fi
    if [ -z "$install_root" ] && [ -n "$(find "$install_env" -prune ! -user 0 -print)" ]; then
        echo "error: $install_env holds SRETAB_PAT but is not owned by root." >&2
        echo "       sudo chown root:root $install_env, then re-run. Nothing has been installed or changed." >&2
        exit 2
    fi
fi

install -d -m 0755 "$quadlet_dir" "$systemd_dir" "$config_dir"
install -m 0644 "$script_dir/install.env.example" "$config_dir/install.env.example"
install -m 0644 "$script_dir/quadlet/"*.network "$quadlet_dir/"
install -m 0644 "$script_dir/quadlet/"*.volume "$quadlet_dir/"
install -m 0644 "$script_dir/quadlet/"*.container "$quadlet_dir/"
# Native units: Quadlet generates darkflib-kev.service, and a generated unit cannot be enabled, but its timer can.
install -m 0644 "$script_dir/systemd/"*.timer "$systemd_dir/"

# The port as a Quadlet drop-in, so the installed unit stays byte-identical to the repository. The empty PublishPort=
# resets the list; without it the default port would stay open beside the new one.
dropin_dir="$quadlet_dir/darkflib-web.container.d"
dropin="$dropin_dir/10-published-port.conf"
if [ "$web_port_set" = true ]; then
    install -d -m 0755 "$dropin_dir"
    tmp=$(mktemp "${TMPDIR:-/tmp}/darkflib-port.XXXXXX")
    cat > "$tmp" <<EOF
# Generated by deploy/install.sh from DARKFLIB_WEB_PORT in /etc/darkflib/install.env. Edit that and re-run.
[Container]
PublishPort=
PublishPort=127.0.0.1:$web_port:8080
EOF
    install -m 0644 "$tmp" "$dropin"
    rm -f "$tmp"
    echo "darkflib-web published on 127.0.0.1:$web_port (container port 8080)"
else
    # Absent setting means the shipped default, including on a host that used to override it.
    rm -f "$dropin"
    rmdir "$dropin_dir" 2>/dev/null || true
fi

# --- nginx vhost ----------------------------------------------------------------------------------------------------
if [ "$install_nginx" = true ]; then
    # proxy_cache_path creates only its last component. nginx.org packages ship /var/cache/nginx; Debian's nginx does
    # not, and without it `nginx -t` fails on "mkdir() /var/cache/nginx/darkflib".
    install -d -m 0755 "$install_root/var/cache/nginx"
    if [ -n "$install_root" ]; then
        install -d -m 0755 "$nginx_dir"
        install -m 0644 "$script_dir/nginx/darkflib.conf" "$nginx_dir/darkflib.conf"
    else
        # nginx -t validates what is on disk, so install first and restore on failure; otherwise a broken vhost sits
        # there until nginx's next restart refuses to start.
        live="$nginx_dir/darkflib.conf"
        backup=$(mktemp)
        had_live=false
        if [ -f "$live" ]; then
            cp -p "$live" "$backup"
            had_live=true
        fi
        install -m 0644 "$script_dir/nginx/darkflib.conf" "$live"
        if ! nginx -t; then
            echo "error: nginx -t rejected darkflib.conf; restoring the previous state" >&2
            if [ "$had_live" = true ]; then install -m 0644 "$backup" "$live"; else rm -f "$live"; fi
            rm -f "$backup"
            nginx -t || echo "error: nginx still does not validate; fix conf.d by hand" >&2
            exit 1
        fi
        rm -f "$backup"
        systemctl reload nginx
        echo "nginx vhost installed and reloaded"
    fi
fi

if [ -n "$install_root" ]; then
    echo "darkflib.com deployment files staged below $install_root"
    exit 0
fi

systemctl daemon-reload

# The secret follows install.env on every run, so a rotated token is used from the next refresh without a restart.
if [ -n "$sretab_pat" ]; then
    # printf is a shell builtin: the token reaches podman on stdin, never in argv.
    printf '%s' "$sretab_pat" | podman secret create --replace "$secret_name" - >/dev/null
    echo "SRETAB_PAT loaded into podman secret $secret_name"
elif podman secret exists "$secret_name" 2>/dev/null; then
    # Without its credential the timer can only fail, so it goes too, now rather than at the next --start.
    systemctl disable --now darkflib-kev.timer 2>/dev/null || true
    podman secret rm "$secret_name" >/dev/null
    echo "SRETAB_PAT is not set: removed podman secret $secret_name and disabled darkflib-kev.timer"
fi

if [ "$start_services" = true ]; then
    # A crash-looping unit hits its start limit and refuses to start until reset; clear that so a re-run can repair it.
    systemctl reset-failed darkflib-network.service darkflib-feeds-volume.service darkflib-web.service \
        darkflib-kev.service 2>/dev/null || true
    # One transaction so systemd orders them. The network and volume units are RemainAfterExit oneshots: restarting
    # them re-creates a removed network or volume and leaves a healthy one alone.
    systemctl restart darkflib-network.service darkflib-feeds-volume.service darkflib-web.service

    if [ -n "$sretab_pat" ]; then
        systemctl enable --now darkflib-kev.timer
        # The first snapshot now rather than at the next :37. The site is already up, so a failure here is a warning:
        # the page hides the panel until a refresh succeeds, or shows the last snapshot's age.
        if systemctl start darkflib-kev.service; then
            echo "KEV snapshot refreshed"
        else
            echo "warning: the KEV snapshot refresh failed; see journalctl -u darkflib-kev.service" >&2
        fi
    else
        systemctl disable --now darkflib-kev.timer 2>/dev/null || true
        echo "SRETAB_PAT is not set in $install_env: no KEV snapshot, darkflib-kev.timer disabled"
    fi
fi

echo "darkflib.com deployment files installed"
if [ "$start_services" = false ]; then
    echo "Run $0 --start to (re)start the site"
fi
