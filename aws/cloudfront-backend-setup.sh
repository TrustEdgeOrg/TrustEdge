#!/bin/bash
# Bash script to create a CloudFront distribution for the backend API

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
EC2_IP="${BACKEND_EC2_IP:?Set BACKEND_EC2_IP in aws/.env}"
EC2_PUBLIC_DNS="${BACKEND_EC2_PUBLIC_DNS:?Set BACKEND_EC2_PUBLIC_DNS in aws/.env}"
BACKEND_PORT="${BACKEND_PORT:?Set BACKEND_PORT in aws/.env}"
DISTRIBUTION_COMMENT="${BACKEND_CLOUDFRONT_COMMENT:?Set BACKEND_CLOUDFRONT_COMMENT in aws/.env}"

echo "Setting up CloudFront distribution for TrustEdge backend..."
echo "EC2 IP: $EC2_IP"
echo "EC2 Public DNS: $EC2_PUBLIC_DNS"
echo "Backend Port: $BACKEND_PORT"
echo ""

# Step 1: Create CloudFront distribution configuration
echo "Step 1: Creating CloudFront distribution configuration..."

cat > /tmp/cloudfront-backend-config.json <<EOF
{
  "CallerReference": "trustedge-backend-$(date +%Y%m%d%H%M%S)",
  "Comment": "$DISTRIBUTION_COMMENT",
  "DefaultCacheBehavior": {
    "TargetOriginId": "trustedge-backend-origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 7,
      "Items": ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
      "CachedMethods": {
        "Quantity": 2,
        "Items": ["GET", "HEAD"]
      }
    },
    "Compress": true,
    "ForwardedValues": {
      "QueryString": true,
      "Cookies": {
        "Forward": "all"
      },
      "Headers": {
        "Quantity": 5,
        "Items": ["Host", "Authorization", "Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"]
      }
    },
    "MinTTL": 0,
    "DefaultTTL": 0,
    "MaxTTL": 0
  },
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "trustedge-backend-origin",
        "DomainName": "$EC2_PUBLIC_DNS",
        "CustomOriginConfig": {
          "HTTPPort": $BACKEND_PORT,
          "HTTPSPort": 443,
          "OriginProtocolPolicy": "http-only",
          "OriginSslProtocols": {
            "Quantity": 1,
            "Items": ["TLSv1.2"]
          }
        }
      }
    ]
  },
  "Enabled": true,
  "PriceClass": "PriceClass_100"
}
EOF

echo "[OK] Configuration file created"
echo ""

# Step 2: Create CloudFront distribution
echo "Step 2: Creating CloudFront distribution..."
if aws cloudfront create-distribution --distribution-config "file:///tmp/cloudfront-backend-config.json" --output json > /tmp/cloudfront-response.json 2>&1; then
    DISTRIBUTION_ID=$(cat /tmp/cloudfront-response.json | jq -r '.Distribution.Id')
    DOMAIN_NAME=$(cat /tmp/cloudfront-response.json | jq -r '.Distribution.DomainName')
    STATUS=$(cat /tmp/cloudfront-response.json | jq -r '.Distribution.Status')
    
    echo "[OK] CloudFront distribution created successfully!"
    echo ""
    echo "Distribution Details:"
    echo "  Distribution ID: $DISTRIBUTION_ID"
    echo "  Domain Name: $DOMAIN_NAME"
    echo "  Status: $STATUS"
    echo ""
    echo "IMPORTANT:"
    echo "  1. Update your frontend deployment workflow:"
    echo "     BACKEND_API_URL: https://$DOMAIN_NAME"
    echo "  2. Wait 5-10 minutes for CloudFront to deploy"
    echo "  3. Update EC2 security group to allow CloudFront IPs (optional)"
    echo ""
    echo "Your backend API will be available at: https://$DOMAIN_NAME"
else
    echo "[ERROR] Failed to create CloudFront distribution"
    cat /tmp/cloudfront-response.json
    exit 1
fi

# Cleanup
rm -f /tmp/cloudfront-backend-config.json /tmp/cloudfront-response.json
