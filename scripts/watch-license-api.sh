#!/bin/bash

# BitBonsai License API - Watch & Auto-Deploy
# Watches for file changes and auto-syncs to Unraid

WATCH_PATHS=(
    "apps/license-api"
    "libs"
    "package.json"
    "package-lock.json"
)

UNRAID_HOST="unraid"
UNRAID_USER="root"
DEPLOY_PATH="/mnt/user/appdata/bitbonsai-license-api"
UNRAID_SSH="${UNRAID_USER}@${UNRAID_HOST}"

echo "👀 Watching for changes in license-api..."
echo ""
echo "Monitored paths:"
for path in "${WATCH_PATHS[@]}"; do
    echo "  - $path"
done
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Check if fswatch is installed
if ! command -v fswatch &> /dev/null; then
    echo "❌ fswatch not found"
    echo "Install: brew install fswatch"
    exit 1
fi

# Track last package.json change
LAST_PACKAGE_CHANGE=0

# Watch for changes
fswatch -0 -r "${WATCH_PATHS[@]}" | while read -d "" event; do
    # Skip node_modules and dist
    if [[ "$event" == *"node_modules"* ]] || [[ "$event" == *"dist"* ]]; then
        continue
    fi

    echo "📝 Change detected: $event"

    # Check if package.json changed
    if [[ "$event" == *"package.json"* ]] || [[ "$event" == *"package-lock.json"* ]]; then
        NOW=$(date +%s)
        # Debounce: only trigger npm ci once per 5 seconds
        if [ $((NOW - LAST_PACKAGE_CHANGE)) -gt 5 ]; then
            echo "📦 package.json changed - triggering npm ci on Unraid..."
            rsync -az ./package.json ./package-lock.json $UNRAID_SSH:$DEPLOY_PATH/
            ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker exec bitbonsai-license-api npm ci"
            LAST_PACKAGE_CHANGE=$NOW
        fi
    fi

    # Sync changed file
    if [[ "$event" == apps/license-api/* ]]; then
        rsync -az --relative "$event" $UNRAID_SSH:$DEPLOY_PATH/
    elif [[ "$event" == libs/* ]]; then
        rsync -az --relative "$event" $UNRAID_SSH:$DEPLOY_PATH/
    fi

    echo "✅ Synced to Unraid (nodemon will auto-restart)"
    echo ""
done
