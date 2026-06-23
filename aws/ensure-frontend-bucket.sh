#!/bin/bash
# Ensure frontend S3 bucket exists with static website config (idempotent).
# Safe to run from GitHub Actions before s3 sync.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/.env"
    set +a
fi

BUCKET_NAME="${FRONTEND_S3_BUCKET:-trustedge-frontend}"
AWS_REGION="${AWS_REGION:-us-east-1}"

if aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
    echo "[OK] Bucket '$BUCKET_NAME' exists (skipping bootstrap — run aws/s3-setup.sh locally if needed)"
    exit 0
fi

echo "Creating bucket '$BUCKET_NAME'..."
if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$AWS_REGION"
else
    aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$AWS_REGION" \
        --create-bucket-configuration "LocationConstraint=$AWS_REGION"
fi
echo "[OK] Bucket created"

aws s3 website "s3://$BUCKET_NAME/" \
    --index-document index.html \
    --error-document index.html

aws s3api put-public-access-block \
    --bucket "$BUCKET_NAME" \
    --public-access-block-configuration \
    "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadGetObject",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::${BUCKET_NAME}/*"
  }]
}
EOF
)
aws s3api put-bucket-policy --bucket "$BUCKET_NAME" --policy "$POLICY"

echo "[OK] S3 website ready: http://${BUCKET_NAME}.s3-website-${AWS_REGION}.amazonaws.com"
