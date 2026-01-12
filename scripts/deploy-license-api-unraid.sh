#!/bin/bash

# BitBonsai License API - Deploy to Unraid
# Syncs code and restarts container

set -e

UNRAID_HOST="unraid"
UNRAID_USER="root"
DEPLOY_PATH="/mnt/user/appdata/bitbonsai-license-api"
UNRAID_SSH="${UNRAID_USER}@${UNRAID_HOST}"

echo "🚀 Deploying License API to Unraid..."
echo ""

# Step 1: Sync application code
echo "📦 Step 1/5: Syncing application code..."
rsync -az --delete \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.env.local' \
    --exclude '*.db' \
    --exclude '*.db-journal' \
    ./apps/license-api/ $UNRAID_SSH:$DEPLOY_PATH/apps/license-api/

echo "✅ Code synced"
echo ""

# Step 2: Sync shared libs
echo "📚 Step 2/5: Syncing shared libraries..."
rsync -az --delete \
    --exclude 'node_modules' \
    ./libs/ $UNRAID_SSH:$DEPLOY_PATH/libs/

echo "✅ Libraries synced"
echo ""

# Step 3: Sync package files
echo "📋 Step 3/5: Syncing package configuration..."
rsync -az \
    ./package.json \
    ./package-lock.json \
    ./tsconfig.json \
    ./nx.json \
    $UNRAID_SSH:$DEPLOY_PATH/

echo "✅ Package files synced"
echo ""

# Step 4: Create docker-compose if doesn't exist
echo "🐳 Step 4/5: Setting up Docker environment..."
ssh $UNRAID_SSH "mkdir -p $DEPLOY_PATH"

cat << 'EOF' | ssh $UNRAID_SSH "cat > $DEPLOY_PATH/docker-compose.yml"
version: '3.8'

services:
  license-api:
    image: node:20-alpine
    container_name: bitbonsai-license-api
    working_dir: /app
    volumes:
      - ./:/app
      - /app/node_modules
    ports:
      - "3200:3200"
    environment:
      - NODE_ENV=production
      - LICENSE_API_PORT=3200
    env_file:
      - .env
    command: >
      sh -c "
        if [ ! -d node_modules ]; then
          echo '📦 Installing dependencies...' &&
          npm ci
        fi &&
        echo '🔨 Building application...' &&
        npx nx build license-api --skip-nx-cache &&
        echo '🚀 Starting server with auto-reload...' &&
        npx nodemon --watch apps/license-api --watch libs --ext ts,js,json --exec 'npx nx build license-api --skip-nx-cache && node dist/apps/license-api/main.js'
      "
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3200/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
EOF

echo "✅ Docker compose configured"
echo ""

# Step 5: Start/restart container
echo "♻️  Step 5/5: Starting license-api container..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker-compose up -d"

echo "✅ Container started"
echo ""

echo "⏳ Waiting for API to be ready..."
sleep 10

# Health check
if ssh $UNRAID_SSH "curl -f http://localhost:3200/api/health" > /dev/null 2>&1; then
    echo "✅ License API is healthy"
else
    echo "⚠️  Health check failed (may still be starting)"
    echo ""
    echo "Check logs:"
    echo "  ssh $UNRAID_SSH 'docker logs -f bitbonsai-license-api'"
fi

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "📍 License API: http://192.168.1.100:3200/api"
echo "📍 Public URL:  https://api.bitbonsai.app (after tunnel config)"
echo ""
echo "💡 Watch logs:"
echo "   ssh $UNRAID_SSH 'docker logs -f bitbonsai-license-api'"
