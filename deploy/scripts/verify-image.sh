#!/bin/sh
#
# Verify that a darkflib.com image was built and signed by this repository's CI, on main.
#
#   deploy/scripts/verify-image.sh                            # the image pinned in darkflib-web.container
#   deploy/scripts/verify-image.sh ghcr.io/darkflib/darkflib.com@sha256:...
#   deploy/scripts/verify-image.sh --require-attestations      # CI's mode
#
# Two independent checks, as in sre-tab:
#
#   cosign verify          a keyless signature over this digest whose Fulcio certificate names this repository's
#                          ci.yml on refs/heads/main, recorded in Rekor
#   gh attestation verify  SLSA build provenance and an SPDX SBOM issued by GitHub for this digest and repository
#
# Nothing checks this when the container starts: podman's signature policy cannot express a GitHub Actions identity.
# The enforcement points are promotion (promote.sh runs this before writing a pin) and CI (every push re-verifies the
# pinned digest). Non-zero exit means do not pin and do not deploy.

set -eu

IMAGE_REPO=ghcr.io/darkflib/darkflib.com
SOURCE_REPO=Darkflib/darkflib.com
# Anchored at both ends: cosign applies the pattern unanchored, so without ^ and $ a subject merely containing this
# string would pass. Only main publishes; there is no release tagging.
CERT_IDENTITY_RE="^https://github\.com/$SOURCE_REPO/\.github/workflows/ci\.yml@refs/heads/main$"
CERT_OIDC_ISSUER=https://token.actions.githubusercontent.com

require_attestations=false
image=

usage() {
    cat <<'EOF'
Usage: deploy/scripts/verify-image.sh [--require-attestations] [image@sha256:digest]

With no image, verifies the reference pinned in deploy/quadlet/darkflib-web.container.
--require-attestations fails, rather than skips, when gh(1) cannot check provenance and the SBOM.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --require-attestations) require_attestations=true ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*)
            usage >&2
            exit 2
            ;;
        *)
            [ -z "$image" ] || { usage >&2; exit 2; }
            image=$1
            ;;
    esac
    shift
done

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "$script_dir/../.." && pwd)

if [ -z "$image" ]; then
    image=$(sed -n 's/^Image=\(ghcr\.io\/.*\)$/\1/p' "$repo_root/deploy/quadlet/darkflib-web.container" | head -n 1)
    [ -n "$image" ] || { echo "error: no Image= line in deploy/quadlet/darkflib-web.container" >&2; exit 1; }
fi

case "$image" in
    *@sha256:*) ;;
    *)
        echo "error: refusing to verify a reference without a digest: $image" >&2
        echo "       a tag can be moved; a digest cannot." >&2
        exit 2
        ;;
esac

digest=${image##*@}
by_digest="$IMAGE_REPO@$digest"

command -v cosign >/dev/null 2>&1 || {
    echo "error: cosign is not installed: https://docs.sigstore.dev/cosign/system_config/installation/" >&2
    exit 1
}

echo "==> cosign verify $by_digest"
cosign verify \
    --certificate-identity-regexp "$CERT_IDENTITY_RE" \
    --certificate-oidc-issuer "$CERT_OIDC_ISSUER" \
    "$by_digest" >/dev/null
echo "    signature ok: $SOURCE_REPO ci.yml on refs/heads/main"

attest() {
    echo "==> gh attestation verify ($2)"
    gh attestation verify "oci://$by_digest" --repo "$SOURCE_REPO" --predicate-type "$1" >/dev/null
    echo "    $2 ok"
}

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    attest https://slsa.dev/provenance/v1 "SLSA build provenance"
    # Unversioned prefix: gh matches it against https://spdx.dev/Document/v2.3, so an SPDX bump is not a failure.
    attest https://spdx.dev/Document "SPDX SBOM"
elif [ "$require_attestations" = true ]; then
    echo "error: --require-attestations, but gh(1) is missing or not logged in." >&2
    exit 1
else
    echo "==> skipping attestation checks: gh(1) missing or not logged in (the signature above still verified)"
fi

echo
echo "verified: $by_digest"
