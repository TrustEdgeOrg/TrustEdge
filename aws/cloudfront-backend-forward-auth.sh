#!/bin/bash
# Forward Authorization (and CORS preflight) headers on the backend API CloudFront distribution.
# Without Authorization, dashboard API calls return 401 even with a valid baked-in admin token.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/.env"
    set +a
fi

BACKEND_DOMAIN="${BACKEND_API_CLOUDFRONT_URL:-https://daemixzdg8jfd.cloudfront.net}"
BACKEND_DOMAIN="${BACKEND_DOMAIN#https://}"
BACKEND_DOMAIN="${BACKEND_DOMAIN#http://}"
BACKEND_DOMAIN="${BACKEND_DOMAIN%%/*}"
DIST_ID="${BACKEND_CLOUDFRONT_DISTRIBUTION_ID:-}"

REQUIRED_HEADERS=(
    "Host"
    "Authorization"
    "Origin"
    "Access-Control-Request-Method"
    "Access-Control-Request-Headers"
)

if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required. Install with: brew install jq"
    exit 1
fi

if [ -z "$DIST_ID" ]; then
    DIST_ID=$(aws cloudfront list-distributions \
        --query "DistributionList.Items[?DomainName=='${BACKEND_DOMAIN}'].Id | [0]" \
        --output text)
fi

if [ -z "$DIST_ID" ] || [ "$DIST_ID" = "None" ]; then
    echo "ERROR: Could not find CloudFront distribution for domain $BACKEND_DOMAIN"
    echo "Set BACKEND_CLOUDFRONT_DISTRIBUTION_ID in aws/.env"
    exit 1
fi

echo "Updating backend CloudFront forwarded headers..."
echo "Distribution: $DIST_ID ($BACKEND_DOMAIN)"
echo ""

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query ETag --output text)
aws cloudfront get-distribution-config --id "$DIST_ID" --output json > "$TMP_DIR/cf-full.json"

CURRENT=$(jq -r '.DistributionConfig.DefaultCacheBehavior.ForwardedValues.Headers.Items // [] | join(", ")' "$TMP_DIR/cf-full.json")
echo "Current forwarded headers: ${CURRENT:-none}"
echo "Required headers: ${REQUIRED_HEADERS[*]}"
echo ""

jq --argjson headers "$(printf '%s\n' "${REQUIRED_HEADERS[@]}" | jq -R . | jq -s .)" '
  .DistributionConfig.DefaultCacheBehavior.ForwardedValues.Headers = {
    "Quantity": ($headers | length),
    "Items": $headers
  }
  | .DistributionConfig
' "$TMP_DIR/cf-full.json" > "$TMP_DIR/cf-config.json"

echo "Applying CloudFront update..."
aws cloudfront update-distribution \
    --id "$DIST_ID" \
    --if-match "$ETAG" \
    --distribution-config "file://$TMP_DIR/cf-config.json" \
    --output json > "$TMP_DIR/cf-update.json"

STATUS=$(jq -r '.Distribution.Status' "$TMP_DIR/cf-update.json")
echo ""
echo "[OK] Backend CloudFront now forwards Authorization header"
echo "  Status: $STATUS (wait until Deployed)"
echo ""
echo "Next: sync ADMIN_API_TOKEN from EC2 to GitHub secret, then re-run frontend deploy."
