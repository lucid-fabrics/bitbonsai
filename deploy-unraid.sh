#!/bin/bash

# BitBonsai - Deploy to Unraid (Tower) for Remote Development
# This script syncs your local code to Unraid and starts dev containers
# with HMR support and remote debugging enabled

set -e

UNRAID_HOST="unraid"
UNRAID_USER="root"
DEPLOY_PATH="/mnt/user/appdata/bitbonsai-dev"
UNRAID_SSH="${UNRAID_USER}@${UNRAID_HOST}"

echo "🚀 BitBonsai - Deploying to Unraid (Tower)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if unraid is reachable
echo "📡 Checking connection to Unraid..."
if ! ssh -q -o ConnectTimeout=5 $UNRAID_SSH exit; then
    echo "❌ Cannot connect to Unraid. Check your SSH config."
    exit 1
fi
echo "✅ Connected to Unraid"
echo ""

# Create deploy directory on Unraid
echo "📁 Creating deployment directory on Unraid..."
ssh $UNRAID_SSH "mkdir -p $DEPLOY_PATH"
echo ""

# Rsync code to Unraid (excluding node_modules, dist, .nx)
echo "📦 Syncing code to Unraid..."
echo "   Excluding: node_modules, dist, .nx, .git"
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.nx' \
    --exclude '.git' \
    --exclude '*.db' \
    --exclude '*.db-journal' \
    ./ $UNRAID_SSH:$DEPLOY_PATH/

echo ""
echo "✅ Code synced to Unraid:$DEPLOY_PATH"
echo ""

# Ensure correct proxy configuration for Docker environment
echo "🔧 Configuring proxy for Docker environment..."
scp ./proxy.docker.conf.json $UNRAID_SSH:$DEPLOY_PATH/proxy.conf.json
echo "✅ Proxy configured for Docker networking"
echo ""

# Stop existing containers
echo "🛑 Stopping existing containers (if any)..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker-compose -f docker-compose.unraid.yml down || true"
echo ""

# Build and start containers
echo "🏗️  Building and starting containers..."
ssh $UNRAID_SSH "cd $DEPLOY_PATH && docker-compose -f docker-compose.unraid.yml up -d --build"
echo ""

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 5
echo ""

# Get Unraid IP
UNRAID_IP=$(ssh $UNRAID_SSH "hostname -I | awk '{print \$1}'")

# Show status
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌐 Access Points:"
echo "   Frontend: http://${UNRAID_IP}:4210"
echo "   Backend:  http://${UNRAID_IP}:3100"
echo ""
echo "🐛 Remote Debugging:"
echo "   Backend Debug Port: ${UNRAID_IP}:9239"
echo "   VS Code: F5 → '🐛 Debug Backend on Unraid'"
echo ""
echo "📂 Volume Mounts:"
echo "   /mnt/user/Downloads → /media (in containers)"
echo ""
echo "📋 Useful Commands:"
echo "   View logs:     ssh $UNRAID_SSH 'cd $DEPLOY_PATH && docker-compose -f docker-compose.unraid.yml logs -f'"
echo "   Restart:       ssh $UNRAID_SSH 'cd $DEPLOY_PATH && docker-compose -f docker-compose.unraid.yml restart'"
echo "   Stop:          ssh $UNRAID_SSH 'cd $DEPLOY_PATH && docker-compose -f docker-compose.unraid.yml down'"
echo "   Shell (backend): ssh $UNRAID_SSH 'docker exec -it bitbonsai-backend /bin/sh'"
echo ""
echo "🔄 HMR (Hot Module Reload):"
echo "   Edit files locally, run this script again to sync changes"
echo "   Frontend polls every 2 seconds for file changes"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
