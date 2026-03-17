#!/bin/bash

# BitBonsai - Watch and Auto-Sync to Unraid
# Watches for file changes and automatically syncs to Unraid for instant HMR

UNRAID_HOST="unraid"
UNRAID_USER="root"
DEPLOY_PATH="/mnt/user/appdata/bitbonsai-dev"
UNRAID_SSH="${UNRAID_USER}@${UNRAID_HOST}"

echo "👀 Watching for file changes..."
echo "Press Ctrl+C to stop"
echo ""

# Watch for changes and sync (requires fswatch)
if ! command -v fswatch &> /dev/null; then
    echo "⚠️  fswatch not found. Installing via Homebrew..."
    brew install fswatch
fi

# Sync function
sync_files() {
    echo "🔄 Syncing changes to Unraid..."
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
        --exclude '*.db' \
        --exclude '*.db-journal' \
        ./prisma/ $UNRAID_SSH:$DEPLOY_PATH/prisma/

    rsync -az --delete \
        ./scripts/ $UNRAID_SSH:$DEPLOY_PATH/scripts/

    # Sync critical config files that are mounted in containers
    rsync -az \
        ./proxy.docker.conf.json \
        ./angular.json \
        ./docker-compose.unraid.yml \
        ./nx.json \
        ./tsconfig.json \
        ./package.json \
        ./package-lock.json \
        ./.npmrc \
        $UNRAID_SSH:$DEPLOY_PATH/

    echo "✅ Synced at $(date '+%H:%M:%S')"
}

# Watch for changes in apps/, libs/, and prisma/ directories
fswatch -o ./apps ./libs ./prisma | while read; do
    sync_files
done
