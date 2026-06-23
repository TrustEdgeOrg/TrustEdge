#!/bin/bash

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
BUCKET_NAME="${FRONTEND_S3_BUCKET:?Set FRONTEND_S3_BUCKET in aws/.env}"
AWS_REGION="${AWS_REGION:?Set AWS_REGION in aws/.env}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "Setting up S3 bucket for TrustEdge frontend..."
echo "Bucket name: $BUCKET_NAME"
echo "Region: $AWS_REGION"
echo "Account ID: $ACCOUNT_ID"
echo ""

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "ERROR: AWS CLI is not configured. Please run 'aws configure' first."
    exit 1
fi

# 1. Create S3 bucket
echo "Step 1: Creating S3 bucket..."
if aws s3api head-bucket --bucket $BUCKET_NAME 2>/dev/null; then
    echo "  [OK] Bucket '$BUCKET_NAME' already exists"
else
    if [ "$AWS_REGION" == "us-east-1" ]; then
        # us-east-1 doesn't need LocationConstraint
        aws s3api create-bucket \
            --bucket $BUCKET_NAME \
            --region $AWS_REGION
    else
        aws s3api create-bucket \
            --bucket $BUCKET_NAME \
            --region $AWS_REGION \
            --create-bucket-configuration LocationConstraint=$AWS_REGION
    fi
    
    if [ $? -eq 0 ]; then
        echo "  [OK] Bucket '$BUCKET_NAME' created successfully"
    else
        echo "  [ERROR] Failed to create bucket. It may already exist or the name may be taken."
        echo "    Try a different bucket name (must be globally unique)"
        exit 1
    fi
fi

# 2. Enable static website hosting
echo ""
echo "Step 2: Enabling static website hosting..."
aws s3 website s3://$BUCKET_NAME/ \
    --index-document index.html \
    --error-document index.html

if [ $? -eq 0 ]; then
    echo "  [OK] Static website hosting enabled"
else
    echo "  [ERROR] Failed to enable static website hosting"
    exit 1
fi

# 3. Block public access settings (must run before public bucket policy)
echo ""
echo "Step 3: Configuring public access block settings..."
aws s3api put-public-access-block \
    --bucket $BUCKET_NAME \
    --public-access-block-configuration \
    "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

if [ $? -eq 0 ]; then
    echo "  [OK] Public access block configured"
else
    echo "  [ERROR] Failed to configure public access block"
    exit 1
fi

# 4. Create bucket policy for public read access
echo ""
echo "Step 4: Creating bucket policy for public read access..."
cat > /tmp/bucket-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
    }
  ]
}
EOF

aws s3api put-bucket-policy \
    --bucket $BUCKET_NAME \
    --policy file:///tmp/bucket-policy.json

if [ $? -eq 0 ]; then
    echo "  [OK] Bucket policy applied"
    rm /tmp/bucket-policy.json
else
    echo "  [ERROR] Failed to apply bucket policy"
    exit 1
fi

# 5. Set CORS configuration (for API calls)
echo ""
echo "Step 5: Setting CORS configuration..."
cat > /tmp/cors-config.json <<EOF
{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": [],
      "MaxAgeSeconds": 3000
    }
  ]
}
EOF

aws s3api put-bucket-cors \
    --bucket $BUCKET_NAME \
    --cors-configuration file:///tmp/cors-config.json

if [ $? -eq 0 ]; then
    echo "  [OK] CORS configuration applied"
    rm /tmp/cors-config.json
else
    echo "  [ERROR] Failed to apply CORS configuration"
    exit 1
fi

# 6. Get website endpoint
echo ""
echo "=========================================="
echo "S3 bucket setup complete!"
echo "=========================================="
echo ""
echo "Bucket name: $BUCKET_NAME"
echo "Region: $AWS_REGION"
echo ""
echo "Website endpoint:"
echo "  http://$BUCKET_NAME.s3-website-$AWS_REGION.amazonaws.com"
echo ""
echo "[NOTE] If the bucket name is not globally unique, you'll need to:"
echo "   1. Edit this script and change BUCKET_NAME"
echo "   2. Run this script again"
echo ""
echo "Next step: Create CloudFront distribution (Step 2)"
echo ""
