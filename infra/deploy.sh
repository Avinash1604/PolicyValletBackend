#!/usr/bin/env bash
# Build the API image, push it to ECR and roll the ECS service.
# Usage: infra/deploy.sh            (uses AWS_REGION or ap-south-1)
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

REPO_URI="$(output PolicyValetBaseStack RepositoryUri)"
REGISTRY="${REPO_URI%%/*}"
TAG="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"

echo "==> Logging in to $REGISTRY"
aws ecr get-login-password --region "$REGION" |
  docker login --username AWS --password-stdin "$REGISTRY"

echo "==> Building $REPO_URI:$TAG (linux/amd64 for t3.micro)"
docker build --platform linux/amd64 -t "$REPO_URI:$TAG" -t "$REPO_URI:latest" "$ROOT"
docker push "$REPO_URI:$TAG"
docker push "$REPO_URI:latest"

# The service exists only after PolicyValetAppStack is deployed.
if CLUSTER="$(output PolicyValetAppStack ClusterName 2>/dev/null)" && [ -n "$CLUSTER" ] && [ "$CLUSTER" != "None" ]; then
  SERVICE="$(output PolicyValetAppStack ServiceName)"
  echo "==> Redeploying $SERVICE"
  aws ecs update-service --region "$REGION" --cluster "$CLUSTER" \
    --service "$SERVICE" --force-new-deployment >/dev/null
  aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE"
  echo "==> Live at $(output PolicyValetAppStack ApiUrl)"
else
  echo "==> Image pushed. Now deploy the app stack: (cd infra && npx cdk deploy PolicyValetAppStack)"
fi
