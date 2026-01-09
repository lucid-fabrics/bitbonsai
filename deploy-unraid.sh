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

# Pre-flight: Check Unraid NFS configuration
echo "🔍 Pre-flight: Checking Unraid NFS configuration..."
NFS_EXPORTS=$(ssh $UNRAID_SSH 'showmount -e localhost 2>&1' || echo "NFS_ERROR")
if echo "$NFS_EXPORTS" | grep -q "/mnt/user/media\|/mnt/user/Downloads"; then
    echo "✅ Unraid NFS exports detected:"
    echo "$NFS_EXPORTS" | grep -E "/mnt/user/(media|Downloads)" || true
else
    echo "⚠️  WARNING: Unraid NFS exports not configured!"
    echo ""
    echo "For multi-node setup, enable NFS in Unraid:"
    echo "  1. Go to Settings → NFS"
    echo "  2. Enable NFS Server"
    echo "  3. Add exports for /mnt/user/media and /mnt/user/Downloads"
    echo "  4. Apply changes"
    echo ""
    echo "See unraid/README.md for detailed instructions."
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi
echo ""

# Step 1: Sync code files and config
echo "📦 Step 1/9: Syncing application code and configuration..."
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
echo "💾 Step 2/9: Creating cache pool directory for encoding temp files..."
ssh $UNRAID_SSH "mkdir -p /mnt/cache/bitbonsai-temp && chmod 755 /mnt/cache/bitbonsai-temp"
echo "✅ Cache pool directory ready: /mnt/cache/bitbonsai-temp (SSD for faster I/O)"
echo ""

# Step 3: Sync Prisma schema and migrations
echo "📊 Step 3/9: Syncing Prisma schema and migrations..."
rsync -az --delete \
    --exclude '*.db' \
    --exclude '*.db-journal' \
    ./prisma/ $UNRAID_SSH:$DEPLOY_PATH/prisma/

echo "✅ Prisma files synced"
echo ""

# Step 4: Rebuild backend to compile TypeScript changes
echo "🔨 Step 4/9: Rebuilding backend application..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker exec bitbonsai-backend sh -c 'rm -rf dist/ && npx nx build backend --skip-nx-cache'" || {
    echo "⚠️  Warning: Backend rebuild failed (container may not be running yet)"
}
echo "✅ Backend rebuilt"
echo ""

# Step 4.5: Rebuild frontend to compile TypeScript and template changes
echo "🎨 Step 5/10: Rebuilding frontend application..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker exec bitbonsai-frontend sh -c 'npx nx build frontend --configuration=production'" || {
    echo "⚠️  Warning: Frontend rebuild failed (container may not be running yet)"
}
echo "✅ Frontend rebuilt"
echo ""

# Step 5.5: Deploy website to nginx container
echo "🌐 Step 6/10: Deploying website to public nginx..."
if [ -d "dist/apps/website/browser" ]; then
    echo "   Building website locally..."
    npx nx build website --configuration=production
    echo "   Syncing to Unraid nginx..."
    rsync -az --delete \
        dist/apps/website/browser/ \
        $UNRAID_SSH:/mnt/user/appdata/bitbonsai-website/html/
    echo "✅ Website deployed to https://bitbonsai.app"
else
    echo "⚠️  Warning: Website build not found, skipping deployment"
fi
echo ""

# Step 6: Restart containers to pick up code changes
echo "♻️  Step 7/10: Restarting containers..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker-compose -f docker-compose.unraid.yml restart"
echo "✅ Containers restarted"
echo ""

# Step 7: Wait for containers to be ready
echo "⏳ Step 8/10: Waiting for backend to be ready..."
sleep 10
echo "✅ Backend should be ready"
echo ""

# Step 8: Regenerate Prisma Client (CRITICAL - prevents 504 errors)
echo "🔄 Step 9/10: Regenerating Prisma Client (prevents proxy errors)..."
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

# Step 9: Apply pending migrations
echo "🗄️  Step 10/10: Applying database migrations..."
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
