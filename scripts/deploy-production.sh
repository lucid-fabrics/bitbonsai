#!/bin/bash
#
# BitBonsai - Deploy Production Container to Unraid
#
# This script builds and deploys the single-container production image.
# Used for testing production builds before pushing to Docker Hub.
#
# Usage:
#   ./scripts/deploy-production.sh [--push]
#
# Options:
#   --push    Push to Docker Hub after building
#

set -e

UNRAID_HOST="${UNRAID_HOST:-unraid}"
UNRAID_USER="${UNRAID_USER:-root}"
UNRAID_SSH="${UNRAID_USER}@${UNRAID_HOST}"
CONTAINER_NAME="bitbonsai"
IMAGE_NAME="lucidfabrics/bitbonsai"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PUSH_TO_HUB=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --push) PUSH_TO_HUB=true; shift ;;
    --tag) IMAGE_TAG="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo ""
echo "🌳 BitBonsai - Production Deployment"
echo "====================================="
echo ""
echo "Image: $IMAGE_NAME:$IMAGE_TAG"
echo "Target: $UNRAID_SSH"
echo ""

# Step 1: Build production image
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 Step 1: Building production image (linux/amd64)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
# Always build for linux/amd64 since Unraid server is x86_64
docker build --platform linux/amd64 -t "$IMAGE_NAME:$IMAGE_TAG" -f Dockerfile.prod --target production .
echo "✅ Image built: $IMAGE_NAME:$IMAGE_TAG"
echo ""

# Step 2: Push to Docker Hub (optional)
if [[ "$PUSH_TO_HUB" == "true" ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📤 Step 2: Pushing to Docker Hub..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  docker push "$IMAGE_NAME:$IMAGE_TAG"
  echo "✅ Pushed to Docker Hub"
  echo ""
else
  # Transfer image directly to Unraid
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📤 Step 2: Transferring image to Unraid..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  docker save "$IMAGE_NAME:$IMAGE_TAG" | ssh "$UNRAID_SSH" 'docker load'
  echo "✅ Image transferred"
  echo ""
fi

# Step 3: Stop existing containers
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🛑 Step 3: Stopping existing containers..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
# Stop old multi-container setup
ssh "$UNRAID_SSH" 'docker stop bitbonsai-backend bitbonsai-frontend bitbonsai-postgres 2>/dev/null || true'
ssh "$UNRAID_SSH" 'docker rm bitbonsai-backend bitbonsai-frontend bitbonsai-postgres 2>/dev/null || true'
# Stop single container
ssh "$UNRAID_SSH" "docker stop $CONTAINER_NAME 2>/dev/null || true"
ssh "$UNRAID_SSH" "docker rm $CONTAINER_NAME 2>/dev/null || true"
echo "✅ Old containers removed"
echo ""

# Step 4: Create directories
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📁 Step 4: Setting up directories..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ssh "$UNRAID_SSH" 'mkdir -p /mnt/user/appdata/bitbonsai'
echo "✅ Directories ready"
echo ""

# Step 5: Start container
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Step 5: Starting BitBonsai container..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ssh "$UNRAID_SSH" "docker run -d \
  --name $CONTAINER_NAME \
  --restart unless-stopped \
  -p 8108:8108 \
  -v /mnt/user/media:/media \
  -v /mnt/user/appdata/bitbonsai:/config \
  -e TZ=America/Montreal \
  $IMAGE_NAME:$IMAGE_TAG"
echo "✅ Container started"
echo ""

# Step 6: Wait and verify
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏳ Step 6: Waiting for startup..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
sleep 15

# Check health
HTTP_CODE=$(ssh "$UNRAID_SSH" "curl -s -o /dev/null -w '%{http_code}' http://localhost:8108/api/v1/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  echo "✅ Health check passed (HTTP 200)"
else
  echo "⚠️  Health check returned HTTP $HTTP_CODE"
  echo "   Checking logs..."
  ssh "$UNRAID_SSH" "docker logs --tail 30 $CONTAINER_NAME"
fi
echo ""

# Show container status
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Container Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ssh "$UNRAID_SSH" "docker ps -f name=$CONTAINER_NAME --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
echo ""

UNRAID_IP=$(ssh "$UNRAID_SSH" "hostname -I | awk '{print \$1}'" 2>/dev/null || echo "192.168.1.100")

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌐 BitBonsai: http://$UNRAID_IP:8108"
echo ""
echo "📋 Useful commands:"
echo "   Logs:    ssh $UNRAID_SSH 'docker logs -f $CONTAINER_NAME'"
echo "   Shell:   ssh $UNRAID_SSH 'docker exec -it $CONTAINER_NAME sh'"
echo "   Restart: ssh $UNRAID_SSH 'docker restart $CONTAINER_NAME'"
echo ""
