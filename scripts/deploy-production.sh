#!/bin/bash
#
# BitBonsai - Deploy Production Container to Unraid
#
# Builds and deploys the single all-in-one production image (embedded
# PostgreSQL, nginx + backend on port 8108). This is the canonical
# implementation; scripts/deploy-unraid.sh is a thin wrapper around it.
#
# Every failure path (docker run itself failing, the health check timing
# out, or a DI-wiring regression slipping past a "healthy" nginx check)
# converges on the same rollback() function, so a failed deploy never
# silently leaves zero containers running or a broken one serving traffic.
#
# Usage:
#   ./scripts/deploy-production.sh [--push]
#
# Options:
#   --push    Push to Docker Hub instead of transferring the image over SSH
#

set -e
set -o pipefail

UNRAID_HOST="${UNRAID_HOST:-unraid}"
UNRAID_USER="${UNRAID_USER:-root}"
UNRAID_SSH="${UNRAID_USER}@${UNRAID_HOST}"
CONTAINER_NAME="bitbonsai"
IMAGE_NAME="lucidfabrics/bitbonsai"
IMAGE_TAG="${IMAGE_TAG:-latest}"
ENV_FILE_PATH="/mnt/user/appdata/bitbonsai-deploy/bitbonsai.env"
PUSH_TO_HUB=false
# Known NestJS dependency-injection wiring error shapes. Not exhaustive (any
# fixed string list can miss a differently-worded DI bug), but covers every
# variant seen so far, including the 2026-07-17 incident this check exists for.
DI_ERROR_PATTERN="can't resolve dependencies|cannot create the .* instance|UnknownExportException|UnknownElementException|is not part of the currently processed module"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --push) PUSH_TO_HUB=true; shift ;;
    --tag) IMAGE_TAG="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Roll back to the previous container. Called from every failure path below,
# so "docker run" itself failing is handled exactly like a failed health
# check or a detected DI regression - never a silent do-nothing.
rollback() {
  local reason="$1"
  echo ""
  echo "$reason"
  echo "----- new container logs (last 60 lines) -----"
  ssh "$UNRAID_SSH" "docker logs '$CONTAINER_NAME' --tail 60 2>&1" || true
  echo "-----------------------------------------------"

  local restored
  restored=$(ssh "$UNRAID_SSH" "
    docker rm -f '$CONTAINER_NAME' > /dev/null 2>&1 || true
    if docker inspect '${CONTAINER_NAME}-old' > /dev/null 2>&1; then
      docker rename '${CONTAINER_NAME}-old' '$CONTAINER_NAME'
      docker start '$CONTAINER_NAME' > /dev/null
      echo restored
    else
      echo none
    fi
  ")

  if [ "$restored" = "restored" ]; then
    echo "Rolled back to the previous container."
  else
    echo "No previous container existed to roll back to (first deploy on this host,"
    echo "or the previous generation was already consumed) - nothing is running now."
  fi
  echo "Deploy FAILED."
  exit 1
}

echo ""
echo "BitBonsai - Production Deployment"
echo "==================================="
echo ""
echo "Image: $IMAGE_NAME:$IMAGE_TAG"
echo "Target: $UNRAID_SSH"
echo ""

if [ -z "${FONTAWESOME_NPM_AUTH_TOKEN:-}" ]; then
  echo "FONTAWESOME_NPM_AUTH_TOKEN is not set. The image build needs it to"
  echo "install the private @fortawesome packages:"
  echo "  export FONTAWESOME_NPM_AUTH_TOKEN='...'"
  exit 1
fi

# Step 1: Build production image
echo "-------------------------------------------------------------------------"
echo "Step 1: Building production image (linux/amd64)..."
echo "-------------------------------------------------------------------------"
# Always build for linux/amd64 since Unraid server is x86_64
docker build --platform linux/amd64 \
  --build-arg FONTAWESOME_NPM_AUTH_TOKEN="$FONTAWESOME_NPM_AUTH_TOKEN" \
  -t "$IMAGE_NAME:$IMAGE_TAG" -f Dockerfile.prod --target production .
echo "Image built: $IMAGE_NAME:$IMAGE_TAG"
echo ""

# Step 2: Push or transfer the image
if [[ "$PUSH_TO_HUB" == "true" ]]; then
  echo "-------------------------------------------------------------------------"
  echo "Step 2: Pushing to Docker Hub..."
  echo "-------------------------------------------------------------------------"
  docker push "$IMAGE_NAME:$IMAGE_TAG"
  echo "Pushed to Docker Hub"
  # docker run does NOT re-pull an already-locally-cached tag on its own, so
  # without this, a second --push deploy in a row would push a new image and
  # then keep running the previous one already cached on the Unraid host.
  echo "Pulling the freshly-pushed image on the Unraid host..."
  ssh "$UNRAID_SSH" "docker pull '$IMAGE_NAME:$IMAGE_TAG'"
  echo ""
else
  echo "-------------------------------------------------------------------------"
  echo "Step 2: Transferring image to Unraid..."
  echo "-------------------------------------------------------------------------"
  docker save "$IMAGE_NAME:$IMAGE_TAG" | ssh "$UNRAID_SSH" 'docker load'
  echo "Image transferred"
  echo ""
fi

# Step 3: Directories + persistent env-file
echo "-------------------------------------------------------------------------"
echo "Step 3: Setting up directories and deploy env-file..."
echo "-------------------------------------------------------------------------"
ssh "$UNRAID_SSH" "mkdir -p /mnt/user/appdata/bitbonsai '$(dirname "$ENV_FILE_PATH")'"

ENV_FILE_EXISTS=$(ssh "$UNRAID_SSH" "[ -f '$ENV_FILE_PATH' ] && echo yes || echo no")
if [ "$ENV_FILE_EXISTS" = "no" ]; then
  echo "  No persisted env-file found, bootstrapping from the running container..."
  ssh "$UNRAID_SSH" "
    set -e
    if docker inspect '$CONTAINER_NAME' > /dev/null 2>&1; then
      docker inspect '$CONTAINER_NAME' --format '{{range .Config.Env}}{{println .}}{{end}}' \
        | grep -vE '^(PATH|NODE_VERSION|YARN_VERSION|HOSTNAME)=' | grep -vE '^\$' \
        > '$ENV_FILE_PATH'
    else
      echo 'No existing container to bootstrap env from. Create $ENV_FILE_PATH manually first' >&2
      echo '(required: DATABASE_URL, JWT_SECRET, LICENSING_SERVICE_URL, LICENSING_ADMIN_API_KEY).' >&2
      exit 1
    fi
  "
else
  echo "  Found existing env-file, reusing it."
fi
echo "Directories ready"
echo ""

# Step 4: Swap the container. Any failure here (including docker run itself
# failing to start, e.g. a bad image or a bound port) goes through rollback()
# rather than aborting with the old container already stopped and nothing
# to replace it.
echo "-------------------------------------------------------------------------"
echo "Step 4: Swapping container..."
echo "-------------------------------------------------------------------------"
# Old split multi-container setup, if it's still lingering on this host
ssh "$UNRAID_SSH" 'docker stop bitbonsai-backend bitbonsai-frontend bitbonsai-postgres 2>/dev/null || true'
ssh "$UNRAID_SSH" 'docker rm bitbonsai-backend bitbonsai-frontend bitbonsai-postgres 2>/dev/null || true'

if ! ssh "$UNRAID_SSH" "
  set -e
  if docker inspect '${CONTAINER_NAME}-old' > /dev/null 2>&1; then
    docker rm -f '${CONTAINER_NAME}-old' > /dev/null
  fi
  if docker inspect '$CONTAINER_NAME' > /dev/null 2>&1; then
    docker stop '$CONTAINER_NAME' > /dev/null
    docker rename '$CONTAINER_NAME' '${CONTAINER_NAME}-old'
  fi
  docker run -d \
    --name $CONTAINER_NAME \
    --restart unless-stopped \
    -p 8108:8108 \
    -v /mnt/user/media:/media \
    -v /mnt/user/appdata/bitbonsai:/config \
    --env-file '$ENV_FILE_PATH' \
    -e TZ=America/Montreal \
    $IMAGE_NAME:$IMAGE_TAG > /dev/null
"; then
  rollback "docker run failed to start the new container."
fi
echo "Container started"
echo ""

# Step 5: Wait for health
echo "-------------------------------------------------------------------------"
echo "Step 5: Waiting for startup..."
echo "-------------------------------------------------------------------------"
HEALTHY="no"
for _ in $(seq 1 40); do
  STATUS=$(ssh "$UNRAID_SSH" "docker inspect '$CONTAINER_NAME' --format '{{.State.Health.Status}}'" 2>/dev/null || echo "")
  if [ "$STATUS" = "healthy" ]; then
    HEALTHY="yes"
    break
  fi
  if [ "$STATUS" = "unhealthy" ]; then
    break
  fi
  sleep 5
done

if [ "$HEALTHY" != "yes" ]; then
  rollback "New container did not become healthy within 200s."
fi
echo "Health check passed"
echo ""

# Step 6: Catch DI-wiring regressions that can slip past the health check -
# Dockerfile.prod's HEALTHCHECK only proves nginx is serving static files
# (see nginx.all-in-one.conf: only /api/ is proxied to the backend), so nginx
# can report healthy while the Node backend crashed at startup.
BOOT_LOG=$(ssh "$UNRAID_SSH" "docker logs '$CONTAINER_NAME' 2>&1")
if echo "$BOOT_LOG" | grep -qiE "$DI_ERROR_PATTERN"; then
  rollback "DI resolution error found in startup logs despite passing health check: $(echo "$BOOT_LOG" | grep -iE "$DI_ERROR_PATTERN" | head -3)"
fi

# Show container status
echo "-------------------------------------------------------------------------"
echo "Container Status"
echo "-------------------------------------------------------------------------"
ssh "$UNRAID_SSH" "docker ps -f name=$CONTAINER_NAME --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
echo ""

UNRAID_IP=$(ssh "$UNRAID_SSH" "hostname -I | awk '{print \$1}'" 2>/dev/null || echo "192.168.1.100")

echo "-------------------------------------------------------------------------"
echo "Deployment Complete"
echo "-------------------------------------------------------------------------"
echo ""
echo "BitBonsai: http://$UNRAID_IP:8108"
echo ""
echo "Notes:"
echo "  - Prisma migrations run automatically on container start."
echo "  - Previous container kept stopped as '${CONTAINER_NAME}-old' for one"
echo "    manual-rollback generation; the next deploy removes it automatically."
echo ""
echo "Useful commands:"
echo "   Logs:    ssh $UNRAID_SSH 'docker logs -f $CONTAINER_NAME'"
echo "   Shell:   ssh $UNRAID_SSH 'docker exec -it $CONTAINER_NAME sh'"
echo "   Restart: ssh $UNRAID_SSH 'docker restart $CONTAINER_NAME'"
echo ""
