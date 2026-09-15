#!/bin/sh
#
# Promote a published build: resolve a commit to its immutable digest, verify the signature, and pin
# deploy/quadlet/darkflib-web.container to it. Upgrading is a reviewed commit, never a restart that happens to pull.
#
#   deploy/scripts/promote.sh              # the build published for origin/main
#   deploy/scripts/promote.sh 1a2b3c4      # a specific commit (must have reached main)
#   deploy/scripts/promote.sh ghcr.io/darkflib/darkflib.com:sha-...@sha256:...
#
# Writes nothing until verify-image.sh passes. Needs curl, cosign, and git; gh for the attestation checks.

set -eu

IMAGE_REPO=ghcr.io/darkflib/darkflib.com
REGISTRY=ghcr.io
REPO_PATH=darkflib/darkflib.com
UNIT=deploy/quadlet/darkflib-web.container

case "${1:-}" in
    -h|--help)
        sed -n '2,11s/^# \{0,1\}//p' "$0"
        exit 0
        ;;
esac
[ "$#" -le 1 ] || { echo "usage: deploy/scripts/promote.sh [commit | image@sha256:digest]" >&2; exit 2; }

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir/../.."

for tool in curl cosign git; do
    command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool is required" >&2; exit 1; }
done

requested=${1:-}
tag=
digest=
case "$requested" in
    *@sha256:*)
        digest=${requested##*@}
        without_digest=${requested%@*}
        case "${without_digest##*/}" in
            *:*) tag=${without_digest##*:} ;;
        esac
        ;;
    "")
        git fetch --quiet origin main
        tag="sha-$(git rev-parse origin/main)"
        ;;
    *)
        commit=$(git rev-parse --verify "$requested^{commit}" 2>/dev/null) || {
            echo "error: not a commit this checkout knows: $requested" >&2
            exit 1
        }
        tag="sha-$commit"
        ;;
esac

if [ -z "$digest" ]; then
    echo "==> resolving $IMAGE_REPO:$tag"
    # Anonymous pull token; the package is public. GHCR_TOKEN overrides it if that ever changes.
    token=${GHCR_TOKEN:-$(curl --fail --silent --show-error \
        "https://$REGISTRY/token?service=$REGISTRY&scope=repository:$REPO_PATH:pull" \
        | sed -n 's/.*"token":[[:space:]]*"\([^"]*\)".*/\1/p')}
    [ -n "$token" ] || { echo "error: could not obtain a registry token for $REPO_PATH" >&2; exit 1; }

    digest=$(curl --fail --silent --show-error --head \
        --header "Authorization: Bearer $token" \
        --header 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' \
        "https://$REGISTRY/v2/$REPO_PATH/manifests/$tag" \
        | tr -d '\r' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: //p' | head -n 1) || {
        echo "error: $IMAGE_REPO:$tag is not published (did CI's publish job run for that commit?)" >&2
        exit 1
    }
fi

case "$digest" in
    sha256:[0-9a-f]*) ;;
    *) echo "error: no digest resolved for $IMAGE_REPO:$tag" >&2; exit 1 ;;
esac

reference="$IMAGE_REPO${tag:+:$tag}@$digest"
echo "    $reference"
echo

"$script_dir/verify-image.sh" "$reference"
echo

current=$(sed -n 's/^Image=\(ghcr\.io\/.*\)$/\1/p' "$UNIT" | head -n 1)
if [ "$current" = "$reference" ]; then
    echo "Nothing to do: $UNIT already pins this digest."
    exit 0
fi

tmp=$(mktemp "${TMPDIR:-/tmp}/promote.XXXXXX")
sed "s|^Image=ghcr\.io/.*$|Image=$reference|" "$UNIT" > "$tmp"
cat "$tmp" > "$UNIT"
rm -f "$tmp"

cat <<EOF
Pinned $reference

Next:

  git diff $UNIT
  git commit -am 'deploy: promote $tag'
  git push

Then on ny03, after pulling that commit:

  sudo deploy/install.sh --start
EOF
