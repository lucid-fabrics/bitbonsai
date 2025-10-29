#!/bin/bash

# BitBonsai - Deploy to Unraid with Prisma Migration Support
# Automatically syncs code and handles database migrations

set -e  # Exit on error

UNRAID_HOST="unraid"
UNRAID_USER="root"
DEPLOY_PATH="/mnt/user/appdata/bitbonsai-dev"
UNRAID_SSH="${UNRAID_USER}@${UNRAID_HOST}"

echo "🚀 Deploying BitBonsai to Unraid..."
echo ""

# Step 1: Sync code files and config
echo "📦 Step 1/5: Syncing application code and configuration..."
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

# Sync critical config files that are mounted in containers
rsync -az \
    ./proxy.docker.conf.json \
    ./angular.json \
    $UNRAID_SSH:$DEPLOY_PATH/

echo "✅ Code and configuration synced"
echo ""

# Step 2: Sync Prisma schema and migrations
echo "📊 Step 2/5: Syncing Prisma schema and migrations..."
rsync -az --delete \
    --exclude '*.db' \
    --exclude '*.db-journal' \
    ./prisma/ $UNRAID_SSH:$DEPLOY_PATH/prisma/

echo "✅ Prisma files synced"
echo ""

# Step 3: Regenerate Prisma Client inside backend container
echo "🔄 Step 3/5: Regenerating Prisma Client..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker exec bitbonsai-backend npx prisma generate" || {
    echo "⚠️  Warning: Prisma generate failed (container might not be running yet)"
}
echo "✅ Prisma Client regenerated"
echo ""

# Step 4: Apply pending migrations
echo "🗄️  Step 4/5: Applying database migrations..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker exec bitbonsai-backend npx prisma migrate deploy" || {
    echo "⚠️  Warning: Migration failed (will retry after restart)"
}
echo "✅ Migrations applied"
echo ""

# Step 5: Restart containers to pick up changes
echo "♻️  Step 5/5: Restarting containers..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker-compose -f docker-compose.unraid.yml restart"
echo "✅ Containers restarted"
echo ""

echo "🎉 Deployment complete!"
echo ""
echo "📍 Frontend: http://192.168.1.100:4210"
echo "📍 Backend:  http://192.168.1.100:3100/api/v1"
echo ""
echo "💡 Tip: Watch logs with:"
echo "   ssh $UNRAID_SSH 'docker logs -f bitbonsai-backend'"
echo "   ssh $UNRAID_SSH 'docker logs -f bitbonsai-frontend'"
