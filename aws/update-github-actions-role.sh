#!/bin/bash
# Bash script to update GitHub Actions IAM role with S3 and CloudFront permissions

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "ERROR: $SCRIPT_DIR/.env not found. Copy aws/.env.example to aws/.env and edit values."
    exit 1
fi
set -a
# shellcheck disable=SC1091
source "$SCRIPT_DIR/.env"
set +a

# Configuration (from .env)
AWS_REGION="${AWS_REGION:?Set AWS_REGION in aws/.env}"
ROLE_NAME="${GITHUB_ACTIONS_ROLE_NAME:?Set GITHUB_ACTIONS_ROLE_NAME in aws/.env}"
S3_BUCKET_NAME="${FRONTEND_S3_BUCKET:?Set FRONTEND_S3_BUCKET in aws/.env}"
ECR_REPOSITORY="${ECR_REPOSITORY:-trustedge-backend}"
CLOUDFRONT_DISTRIBUTION_ID="${FRONTEND_CLOUDFRONT_DISTRIBUTION_ID:?Set FRONTEND_CLOUDFRONT_DISTRIBUTION_ID in aws/.env}"
POLICY_NAME="${GITHUB_ACTIONS_POLICY_NAME:?Set GITHUB_ACTIONS_POLICY_NAME in aws/.env}"

echo "Updating IAM role permissions for GitHub Actions..."
echo "Role: $ROLE_NAME"
echo "S3 Bucket: $S3_BUCKET_NAME"
echo "CloudFront Distribution: $CLOUDFRONT_DISTRIBUTION_ID"
echo ""

# Step 1: Get the current role policy
echo "Step 1: Getting current role policy..."
if aws iam list-role-policies --role-name "$ROLE_NAME" --output json > /dev/null 2>&1; then
    echo "[OK] Role exists"
else
    echo "[ERROR] Role '$ROLE_NAME' not found"
    exit 1
fi

# Step 2: Create policy document
echo "Step 2: Creating policy document..."

cat > /tmp/github-actions-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAccess",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:CreateRepository",
        "ecr:DescribeRepositories"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3BucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:CreateBucket",
        "s3:PutBucketWebsite",
        "s3:PutBucketPolicy",
        "s3:PutBucketPublicAccessBlock",
        "s3:PutBucketCors"
      ],
      "Resource": "arn:aws:s3:::${S3_BUCKET_NAME}"
    },
    {
      "Sid": "S3ObjectAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::${S3_BUCKET_NAME}/*"
    },
    {
      "Sid": "CloudFrontInvalidation",
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation",
        "cloudfront:GetInvalidation",
        "cloudfront:ListInvalidations"
      ],
      "Resource": "*"
    }
  ]
}
EOF

echo "[OK] Policy document created"
echo ""

# Step 3: Put/Update the policy
echo "Step 3: Attaching policy to role..."
if aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "$POLICY_NAME" \
    --policy-document "file:///tmp/github-actions-policy.json" \
    --output json > /dev/null 2>&1; then
    echo "[OK] Policy '$POLICY_NAME' attached successfully"
else
    echo "[ERROR] Failed to attach policy"
    exit 1
fi

# Step 4: Verify the policy
echo "Step 4: Verifying policy..."
if aws iam get-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "$POLICY_NAME" \
    --output json > /dev/null 2>&1; then
    echo "[OK] Policy verified successfully"
    echo ""
    echo "Policy Summary:"
    echo "  - ECR: push/pull + CreateRepository ($ECR_REPOSITORY)"
    echo "  - S3 Bucket: read/write/create/website config on $S3_BUCKET_NAME"
    echo "  - S3 Objects: GetObject, PutObject, DeleteObject on $S3_BUCKET_NAME/*"
    echo "  - CloudFront: CreateInvalidation, GetInvalidation, ListInvalidations"
    echo ""
    echo "Setup complete! GitHub Actions can now deploy to S3 and CloudFront."
else
    echo "[ERROR] Failed to verify policy"
    exit 1
fi

# Cleanup
rm -f /tmp/github-actions-policy.json
