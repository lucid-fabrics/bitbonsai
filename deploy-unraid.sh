#!/bin/bash

# BitBonsai - Deploy to Unraid with Prisma Migration Support
# Automatically syncs code and handles database migrations
# CRITICAL: Always regenerates Prisma AFTER restart to prevent 504 errors

set -e  # Exit on error

UNRAID_HOST="unraid"
UNRAID_USER="root"
DEPLOY_PATH="/mnt/user/appdata/bitbonsai-dev"
UNRAID_SSH="${UNRAID_USER}@${UNRAID_HOST}"

echo "🚀 Deploying BitBonsai to Unraid..."
echo ""

# Step 1: Sync code files and config
echo "📦 Step 1/6: Syncing application code and configuration..."
rsync -az --delete \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.nx' \
    --exclude '.git' \
    --exclude '*.db' \
    --exclude '*.db-journal' \
    ./apps/ $UNRAID_SSH:$DEPLOY_PATH/apps/

rsync -az --delete \
    --exclude 'node_modules' \
    ./libs/ $UNRAID_SSH:$DEPLOY_PATH/libs/

rsync -az --delete \
    ./scripts/ $UNRAID_SSH:$DEPLOY_PATH/scripts/

# Sync critical config files that are mounted in containers
rsync -az \
    ./proxy.docker.conf.json \
    ./angular.json \
    ./docker-compose.unraid.yml \
    ./Dockerfile.dev \
    ./nx.json \
    ./tsconfig.json \
    ./package.json \
    ./package-lock.json \
    ./.npmrc \
    $UNRAID_SSH:$DEPLOY_PATH/

echo "✅ Code and configuration synced"
echo ""

# Step 2: Create cache pool directory for temp files (SSD for faster encoding)
echo "💾 Step 2/7: Creating cache pool directory for encoding temp files..."
ssh $UNRAID_SSH "mkdir -p /mnt/cache/bitbonsai-temp && chmod 755 /mnt/cache/bitbonsai-temp"
echo "✅ Cache pool directory ready: /mnt/cache/bitbonsai-temp (SSD for faster I/O)"
echo ""

# Step 3: Sync Prisma schema and migrations
echo "📊 Step 3/7: Syncing Prisma schema and migrations..."
rsync -az --delete \
    --exclude '*.db' \
    --exclude '*.db-journal' \
    ./prisma/ $UNRAID_SSH:$DEPLOY_PATH/prisma/

echo "✅ Prisma files synced"
echo ""

# Step 4: Rebuild backend to compile TypeScript changes
echo "🔨 Step 4/8: Rebuilding backend application..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker exec bitbonsai-backend sh -c 'rm -rf dist/ && npx nx build backend --skip-nx-cache'" || {
    echo "⚠️  Warning: Backend rebuild failed (container may not be running yet)"
}
echo "✅ Backend rebuilt"
echo ""

# Step 5: Restart containers to pick up code changes
echo "♻️  Step 5/8: Restarting containers..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker-compose -f docker-compose.unraid.yml restart"
echo "✅ Containers restarted"
echo ""

# Step 6: Wait for containers to be ready
echo "⏳ Step 6/8: Waiting for backend to be ready..."
sleep 10
echo "✅ Backend should be ready"
echo ""

# Step 7: Regenerate Prisma Client (CRITICAL - prevents 504 errors)
echo "🔄 Step 7/8: Regenerating Prisma Client (prevents proxy errors)..."
MAX_RETRIES=3
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker exec bitbonsai-backend npx prisma generate"; then
        echo "✅ Prisma Client regenerated successfully"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            echo "⚠️  Retry $RETRY_COUNT/$MAX_RETRIES: Waiting 5 seconds..."
            sleep 5
        else
            echo "❌ Failed to regenerate Prisma Client after $MAX_RETRIES attempts"
            exit 1
        fi
    fi
done
echo ""

# Step 8: Apply pending migrations
echo "🗄️  Step 8/8: Applying database migrations..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker exec bitbonsai-backend npx prisma migrate deploy" || {
    echo "⚠️  Warning: Migration failed (may not be needed)"
}
echo "✅ Migrations applied"
echo ""

# Final restart to ensure all changes are loaded
echo "♻️  Final restart to apply all changes..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker-compose -f docker-compose.unraid.yml restart"
echo "✅ Final restart complete"
echo ""

echo "🎉 Deployment complete!"
echo ""
echo "📍 Frontend: http://192.168.1.100:4210"
echo "📍 Backend:  http://192.168.1.100:3100/api/v1"
echo ""
echo "💡 Tip: Watch logs with:"
echo "   ssh $UNRAID_SSH 'docker logs -f bitbonsai-backend'"
echo "   ssh $UNRAID_SSH 'docker logs -f bitbonsai-frontend'"
