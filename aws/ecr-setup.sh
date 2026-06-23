#!/bin/bash
# Create the backend ECR repository used by deploy-backend.yml (idempotent).

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
ECR_REPOSITORY="${ECR_REPOSITORY:-trustedge-backend}"

echo "Setting up ECR repository for TrustEdge backend..."
echo "Repository: $ECR_REPOSITORY"
echo "Region: $AWS_REGION"
echo ""

if ! aws sts get-caller-identity &>/dev/null; then
    echo "ERROR: AWS CLI is not configured. Run 'aws configure' or export credentials."
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

if aws ecr describe-repositories \
    --repository-names "$ECR_REPOSITORY" \
    --region "$AWS_REGION" \
    --output json >/dev/null 2>&1; then
    echo "[OK] Repository '$ECR_REPOSITORY' already exists"
else
    echo "Creating repository..."
    aws ecr create-repository \
        --repository-name "$ECR_REPOSITORY" \
        --region "$AWS_REGION" \
        --image-scanning-configuration scanOnPush=false \
        --encryption-configuration encryptionType=AES256 \
        --output json >/dev/null
    echo "[OK] Repository '$ECR_REPOSITORY' created"
fi

echo ""
echo "ECR registry: $REGISTRY/$ECR_REPOSITORY"
echo ""
