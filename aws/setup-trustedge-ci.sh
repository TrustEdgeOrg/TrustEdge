#!/bin/bash
# One-shot provisioning for TrustEdge CI/CD AWS resources (Option B rebrand).
#
# Creates / verifies:
#   - S3 frontend bucket (static website)
#   - ECR backend repository
#   - GitHub Actions deploy role inline policy (S3 + ECR + CloudFront invalidation)
#   - CloudFront distribution origin -> new S3 website bucket
#
# Prerequisites: AWS CLI configured with permissions to create S3, ECR, IAM, CloudFront.
# Usage:
#   cp aws/.env.example aws/.env   # edit GITHUB_ACTIONS_ROLE_NAME
#   bash aws/setup-trustedge-ci.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

info() { echo -e "${GREEN}==>${NC} $*"; }
err()  { echo -e "${RED}ERROR:${NC} $*" >&2; }

if ! command -v aws >/dev/null 2>&1; then
    err "AWS CLI not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    err "jq not found. Install: brew install jq"
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$ENV_EXAMPLE" ]; then
        info "Creating aws/.env from .env.example"
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        err "Edit aws/.env and set GITHUB_ACTIONS_ROLE_NAME (and verify bucket/ECR/CloudFront IDs), then re-run."
        exit 1
    fi
    err "Missing aws/.env — copy aws/.env.example to aws/.env"
    exit 1
fi

set -a
# shellcheck disable=SC1091
source "$ENV_FILE"
set +a

AWS_REGION="${AWS_REGION:-us-east-1}"
FRONTEND_S3_BUCKET="${FRONTEND_S3_BUCKET:-trustedge-frontend}"
ECR_REPOSITORY="${ECR_REPOSITORY:-trustedge-backend}"
FRONTEND_CLOUDFRONT_DISTRIBUTION_ID="${FRONTEND_CLOUDFRONT_DISTRIBUTION_ID:-E26UGOT5YUPFRY}"

if [ -z "${GITHUB_ACTIONS_ROLE_NAME:-}" ] || [ "$GITHUB_ACTIONS_ROLE_NAME" = "YourGitHubActionsDeployRole" ]; then
    err "Set GITHUB_ACTIONS_ROLE_NAME in aws/.env to your GitHub Actions OIDC IAM role name."
    err "  (Same role as GitHub secret AWS_ROLE_ARN, e.g. arn:aws:iam::804012660077:role/MyRole -> MyRole)"
    exit 1
fi

if [ -z "${GITHUB_ACTIONS_POLICY_NAME:-}" ] || [ "$GITHUB_ACTIONS_POLICY_NAME" = "YourGitHubActionsDeployPolicy" ]; then
    err "Set GITHUB_ACTIONS_POLICY_NAME in aws/.env"
    exit 1
fi

if ! aws sts get-caller-identity &>/dev/null; then
    err "AWS CLI not authenticated. Run: aws configure"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo ""
info "TrustEdge CI AWS provisioning"
echo "  Account:     $ACCOUNT_ID"
echo "  Region:      $AWS_REGION"
echo "  S3 bucket:   $FRONTEND_S3_BUCKET"
echo "  ECR repo:    $ECR_REPOSITORY"
echo "  CloudFront:  $FRONTEND_CLOUDFRONT_DISTRIBUTION_ID"
echo "  IAM role:    $GITHUB_ACTIONS_ROLE_NAME"
echo ""

info "Step 1/5 — S3 frontend bucket"
bash "$SCRIPT_DIR/s3-setup.sh"

info "Step 2/5 — ECR backend repository"
bash "$SCRIPT_DIR/ecr-setup.sh"

info "Step 3/5 — GitHub Actions IAM policy"
bash "$SCRIPT_DIR/update-github-actions-role.sh"

info "Step 4/5 — CloudFront frontend origin"
bash "$SCRIPT_DIR/cloudfront-frontend-update-origin.sh"

info "Step 5/5 — Backend CloudFront Authorization header"
bash "$SCRIPT_DIR/cloudfront-backend-forward-auth.sh"

CF_DOMAIN=$(aws cloudfront get-distribution \
    --id "$FRONTEND_CLOUDFRONT_DISTRIBUTION_ID" \
    --query 'Distribution.DomainName' \
    --output text 2>/dev/null || echo "unknown")

echo ""
echo "=========================================="
echo "TrustEdge CI provisioning complete"
echo "=========================================="
echo ""
echo "Frontend deploy target:"
echo "  S3:         s3://$FRONTEND_S3_BUCKET"
echo "  Website:    http://$FRONTEND_S3_BUCKET.s3-website-$AWS_REGION.amazonaws.com"
echo "  CloudFront: https://$CF_DOMAIN"
echo ""
echo "Backend deploy target:"
echo "  ECR:        $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY"
echo ""
echo "Next steps:"
echo "  1. Re-run GitHub Actions: Build and Deploy Frontend + Backend"
echo "  2. On EC2, set ALLOWED_ORIGINS to include https://$CF_DOMAIN"
echo "  3. Sync ADMIN_API_TOKEN from EC2 to GitHub secrets"
echo "  4. Frontend build must use HTTPS API (BACKEND_API_URL=https://daemixzdg8jfd.cloudfront.net)"
echo ""
