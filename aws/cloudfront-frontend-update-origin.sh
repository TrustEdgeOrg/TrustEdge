#!/bin/bash
# Point the frontend CloudFront distribution at the configured S3 website origin (idempotent).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "ERROR: $SCRIPT_DIR/.env not found. Run: bash aws/setup-trustedge-ci.sh"
    exit 1
fi
set -a
# shellcheck disable=SC1091
source "$SCRIPT_DIR/.env"
set +a

AWS_REGION="${AWS_REGION:?Set AWS_REGION in aws/.env}"
BUCKET_NAME="${FRONTEND_S3_BUCKET:?Set FRONTEND_S3_BUCKET in aws/.env}"
DIST_ID="${FRONTEND_CLOUDFRONT_DISTRIBUTION_ID:?Set FRONTEND_CLOUDFRONT_DISTRIBUTION_ID in aws/.env}"
NEW_ORIGIN_DOMAIN="${BUCKET_NAME}.s3-website-${AWS_REGION}.amazonaws.com"

if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required. Install with: brew install jq"
    exit 1
fi

echo "Updating CloudFront frontend origin..."
echo "Distribution: $DIST_ID"
echo "New origin domain: $NEW_ORIGIN_DOMAIN"
echo ""

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query ETag --output text)
aws cloudfront get-distribution-config --id "$DIST_ID" --output json > "$TMP_DIR/cf-full.json"

CURRENT_DOMAINS=$(jq -r '.DistributionConfig.Origins.Items[].DomainName' "$TMP_DIR/cf-full.json")
echo "Current origin domain(s):"
echo "$CURRENT_DOMAINS" | sed 's/^/  /'
echo ""

if echo "$CURRENT_DOMAINS" | grep -qx "$NEW_ORIGIN_DOMAIN"; then
    echo "[OK] CloudFront already points at $NEW_ORIGIN_DOMAIN"
    CF_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.DomainName' --output text)
    echo "CloudFront URL: https://$CF_DOMAIN"
    exit 0
fi

DEFAULT_TARGET=$(jq -r '.DistributionConfig.DefaultCacheBehavior.TargetOriginId' "$TMP_DIR/cf-full.json")

jq --arg domain "$NEW_ORIGIN_DOMAIN" --arg default_id "$DEFAULT_TARGET" '
  .DistributionConfig.Origins.Items |= map(
    if (.DomainName | test("s3-website|frontend")) or (.Id == $default_id) then
      .DomainName = $domain
    else .
    end
  )
  | .DistributionConfig
' "$TMP_DIR/cf-full.json" > "$TMP_DIR/cf-config.json"

NEW_DOMAINS=$(jq -r '.Origins.Items[].DomainName' "$TMP_DIR/cf-config.json")
if ! echo "$NEW_DOMAINS" | grep -qx "$NEW_ORIGIN_DOMAIN"; then
    echo "ERROR: Failed to update any CloudFront origin to $NEW_ORIGIN_DOMAIN"
    echo "Edit the distribution manually in AWS Console -> CloudFront -> Origins"
    exit 1
fi

echo "Applying CloudFront update (may take a few minutes to deploy)..."
aws cloudfront update-distribution \
    --id "$DIST_ID" \
    --if-match "$ETAG" \
    --distribution-config "file://$TMP_DIR/cf-config.json" \
    --output json > "$TMP_DIR/cf-update.json"

CF_DOMAIN=$(jq -r '.Distribution.DomainName' "$TMP_DIR/cf-update.json")
STATUS=$(jq -r '.Distribution.Status' "$TMP_DIR/cf-update.json")

echo ""
echo "[OK] CloudFront origin updated"
echo "  Status: $STATUS (wait until Deployed before testing)"
echo "  URL: https://$CF_DOMAIN"
echo ""
