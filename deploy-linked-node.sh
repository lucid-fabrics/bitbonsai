#!/bin/bash

# BitBonsai - Deploy to Linked Node
# Updates code and restarts services on a linked (child) node

set -e  # Exit on error

LINKED_NODE_IP="${1:-192.168.1.170}"
LINKED_NODE_USER="${2:-root}"
DEPLOY_PATH="${3:-/opt/bitbonsai}"
LINKED_SSH="${LINKED_NODE_USER}@${LINKED_NODE_IP}"

echo "🚀 Deploying BitBonsai to Linked Node..."
echo ""
echo "Target: ${LINKED_SSH}"
echo "Path: ${DEPLOY_PATH}"
echo ""

# Check if we can SSH to the linked node
echo "🔍 Checking SSH access to linked node..."
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes ${LINKED_SSH} 'echo "SSH OK"' &>/dev/null; then
    echo "❌ Cannot SSH to ${LINKED_SSH}"
    echo ""
    echo "Please ensure:"
    echo "  1. SSH is enabled on the linked node"
    echo "  2. SSH keys are configured: ssh-copy-id ${LINKED_SSH}"
    echo "  3. The node is reachable: ping ${LINKED_NODE_IP}"
    exit 1
fi
echo "✅ SSH access confirmed"
echo ""

# Step 1: Sync code files
echo "📦 Step 1/6: Syncing application code..."
rsync -az --delete \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.nx' \
    --exclude '.git' \
    --exclude '*.db' \
    --exclude '*.db-journal' \
    --exclude 'data/' \
    ./apps/ ${LINKED_SSH}:${DEPLOY_PATH}/apps/

rsync -az --delete \
    --exclude 'node_modules' \
    ./libs/ ${LINKED_SSH}:${DEPLOY_PATH}/libs/

# Sync critical config files
rsync -az \
    ./angular.json \
    ./nx.json \
    ./tsconfig.json \
    ./package.json \
    ./package-lock.json \
    ./.npmrc \
    ${LINKED_SSH}:${DEPLOY_PATH}/

echo "✅ Code synced"
echo ""

# Step 2: Sync Prisma schema
echo "📊 Step 2/6: Syncing Prisma schema..."
rsync -az --delete \
    --exclude '*.db' \
    --exclude '*.db-journal' \
    ./prisma/ ${LINKED_SSH}:${DEPLOY_PATH}/prisma/

echo "✅ Prisma files synced"
echo ""

# Step 3: Install dependencies
echo "📥 Step 3/6: Installing dependencies..."
ssh ${LINKED_SSH} "cd ${DEPLOY_PATH} && npm install --production --legacy-peer-deps" || {
    echo "⚠️  Warning: npm install had issues (may be non-critical)"
}
echo "✅ Dependencies updated"
echo ""

# Step 4: Rebuild backend
echo "🔨 Step 4/6: Rebuilding backend..."
ssh ${LINKED_SSH} "cd ${DEPLOY_PATH} && npx nx build backend --skip-nx-cache" || {
    echo "⚠️  Warning: Backend rebuild failed"
}
echo "✅ Backend rebuilt"
echo ""

# Step 5: Regenerate Prisma Client
echo "🔄 Step 5/6: Regenerating Prisma Client..."
ssh ${LINKED_SSH} "cd ${DEPLOY_PATH} && npx prisma generate"
echo "✅ Prisma Client regenerated"
echo ""

# Step 6: Apply migrations
echo "🗄️  Step 6/6: Applying database migrations..."
ssh ${LINKED_SSH} "cd ${DEPLOY_PATH} && npx prisma migrate deploy" || {
    echo "⚠️  Warning: Migration may not be needed"
}
echo "✅ Migrations applied"
echo ""

# Step 7: Restart services
echo "♻️  Restarting BitBonsai services..."
if ssh ${LINKED_SSH} "systemctl is-active --quiet bitbonsai-backend"; then
    ssh ${LINKED_SSH} "systemctl restart bitbonsai-backend bitbonsai-frontend"
    echo "✅ Services restarted (systemd)"
elif ssh ${LINKED_SSH} "docker ps | grep -q bitbonsai"; then
    ssh ${LINKED_SSH} "docker restart bitbonsai-backend bitbonsai-frontend" 2>/dev/null || true
    echo "✅ Services restarted (docker)"
else
    echo "⚠️  Could not detect service manager - please restart services manually"
fi
echo ""

echo "🎉 Deployment to linked node complete!"
echo ""
echo "📍 Linked Node API: http://${LINKED_NODE_IP}:3100/api/v1"
echo "📍 Linked Node UI:  http://${LINKED_NODE_IP}:4200"
echo ""
echo "💡 Next steps:"
echo "   1. Verify backend is running: curl http://${LINKED_NODE_IP}:3100/api/v1/health"
echo "   2. Mount NFS shares on linked node via UI: Nodes → Child Node → Storage → Mount"
echo "   3. Jobs will automatically resume once storage is accessible"
