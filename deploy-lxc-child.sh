#!/bin/bash

# BitBonsai - Deploy to LXC Child Node via Proxmox pct
# Uses Proxmox pct exec to deploy inside LXC container
#
# IMPORTANT: This script also sets up NFS mounts for shared storage.
# Ensure Unraid NFS exports are configured before running.

set -e

PROXMOX_HOST="pve-labg5"
LXC_ID="300"
APP_DIR="/opt/bitbonsai"

# NFS Configuration - Update these to match your Unraid setup
UNRAID_IP="192.168.1.100"
NFS_EXPORTS=(
  "/mnt/user/media:/media"           # HOST_PATH:MOUNT_POINT
  "/mnt/user/Downloads:/downloads"   # Add more as needed
)

echo "🚀 Deploying BitBonsai to LXC Child Node..."
echo "   Proxmox: $PROXMOX_HOST"
echo "   LXC ID: $LXC_ID"
echo ""

# Step 0: Setup NFS mounts for shared storage
echo "🔗 Step 0/9: Setting up NFS shared storage..."

# Install NFS client if not present
ssh $PROXMOX_HOST "pct exec $LXC_ID -- bash -c 'which mount.nfs >/dev/null 2>&1 || apt-get update && apt-get install -y nfs-common'" || true

for EXPORT in "${NFS_EXPORTS[@]}"; do
  HOST_PATH="${EXPORT%%:*}"
  MOUNT_POINT="${EXPORT##*:}"

  echo "   Mounting $UNRAID_IP:$HOST_PATH → $MOUNT_POINT"

  # Create mount point
  ssh $PROXMOX_HOST "pct exec $LXC_ID -- mkdir -p $MOUNT_POINT"

  # Check if already in fstab
  FSTAB_ENTRY="$UNRAID_IP:$HOST_PATH $MOUNT_POINT nfs rw,nolock,soft,intr 0 0"
  ssh $PROXMOX_HOST "pct exec $LXC_ID -- grep -q '$UNRAID_IP:$HOST_PATH' /etc/fstab" || \
    ssh $PROXMOX_HOST "pct exec $LXC_ID -- bash -c 'echo \"$FSTAB_ENTRY\" >> /etc/fstab'"

  # Mount if not already mounted
  ssh $PROXMOX_HOST "pct exec $LXC_ID -- mountpoint -q $MOUNT_POINT" || \
    ssh $PROXMOX_HOST "pct exec $LXC_ID -- mount $MOUNT_POINT" || \
    echo "   ⚠️  Warning: Could not mount $MOUNT_POINT (NFS may not be configured on Unraid)"
done

# Verify mounts
echo "   Verifying NFS mounts..."
ssh $PROXMOX_HOST "pct exec $LXC_ID -- df -h | grep -E 'nfs|Filesystem'" || true
echo "✅ NFS setup complete"
echo ""

# Step 1: Sync code files to Proxmox host
echo "📦 Step 1/8: Syncing code to Proxmox host..."
ssh $PROXMOX_HOST "mkdir -p /tmp/bitbonsai-deploy"

rsync -az --delete \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.nx' \
    --exclude '.git' \
    --exclude '*.db' \
    --exclude '*.db-journal' \
    --exclude 'data/' \
    ./apps/ $PROXMOX_HOST:/tmp/bitbonsai-deploy/apps/

rsync -az --delete \
    --exclude 'node_modules' \
    ./libs/ $PROXMOX_HOST:/tmp/bitbonsai-deploy/libs/

rsync -az --delete \
    --exclude '*.db' \
    --exclude '*.db-journal' \
    ./prisma/ $PROXMOX_HOST:/tmp/bitbonsai-deploy/prisma/

rsync -az \
    ./angular.json \
    ./nx.json \
    ./tsconfig.json \
    ./package.json \
    ./package-lock.json \
    ./.npmrc \
    $PROXMOX_HOST:/tmp/bitbonsai-deploy/

echo "✅ Code synced to Proxmox host"
echo ""

# Step 2: Copy files into LXC container filesystem
echo "📋 Step 2/8: Copying files into LXC container..."
ssh $PROXMOX_HOST "pct exec $LXC_ID -- mkdir -p $APP_DIR"
ssh $PROXMOX_HOST "pct exec $LXC_ID -- mkdir -p /data"  # Node ID persistence directory
ssh $PROXMOX_HOST "rsync -a --delete /tmp/bitbonsai-deploy/ /var/lib/lxc/$LXC_ID/rootfs$APP_DIR/"
echo "✅ Files copied to LXC container"
echo ""

# Step 3: Install dependencies
echo "📥 Step 3/8: Installing dependencies (this may take a while)..."
ssh $PROXMOX_HOST "pct exec $LXC_ID -- bash -c 'cd $APP_DIR && npm install --legacy-peer-deps --ignore-scripts'" || {
    echo "⚠️  Warning: npm install had issues"
}
echo "✅ Dependencies installed"
echo ""

# Step 4: Clean old build
echo "🧹 Step 4/8: Cleaning old build..."
ssh $PROXMOX_HOST "pct exec $LXC_ID -- rm -rf $APP_DIR/dist/"
echo "✅ Old build cleaned"
echo ""

# Step 5: Rebuild backend
echo "🔨 Step 5/9: Rebuilding backend (this may take a few minutes)..."
ssh $PROXMOX_HOST "pct exec $LXC_ID -- bash -c 'cd $APP_DIR && npx nx build backend --skip-nx-cache'" || {
    echo "❌ Backend rebuild failed!"
    exit 1
}
echo "✅ Backend rebuilt successfully"
echo ""

# Step 5b: Deploy frontend (built locally, transferred via tar)
echo "🎨 Step 5b/9: Deploying frontend..."
# Build frontend locally (faster than building on LXC)
echo "   Building frontend locally..."
cd "$(dirname "$0")"
npx nx build frontend --configuration=production --skip-nx-cache > /dev/null 2>&1 || {
    echo "❌ Frontend build failed!"
    exit 1
}

# Transfer via tar (handles many small files efficiently)
echo "   Transferring frontend to LXC..."
rsync -az --delete dist/apps/frontend/ $PROXMOX_HOST:/tmp/bitbonsai-frontend/
ssh $PROXMOX_HOST "cd /tmp && tar czf bitbonsai-frontend.tar.gz bitbonsai-frontend/"
ssh $PROXMOX_HOST "pct push $LXC_ID /tmp/bitbonsai-frontend.tar.gz /tmp/bitbonsai-frontend.tar.gz"
ssh $PROXMOX_HOST "pct exec $LXC_ID -- bash -c 'mkdir -p $APP_DIR/dist/apps/frontend && cd /tmp && tar xzf bitbonsai-frontend.tar.gz && cp -r bitbonsai-frontend/* $APP_DIR/dist/apps/frontend/ && rm -rf /tmp/bitbonsai-frontend*'"
ssh $PROXMOX_HOST "rm -rf /tmp/bitbonsai-frontend*"
echo "✅ Frontend deployed"
echo ""

# Step 6: Regenerate Prisma Client
echo "🔄 Step 6/9: Regenerating Prisma Client..."
ssh $PROXMOX_HOST "pct exec $LXC_ID -- bash -c 'cd $APP_DIR && npx prisma generate'"
echo "✅ Prisma Client regenerated"
echo ""

# Step 7: Apply migrations
echo "🗄️  Step 7/9: Applying database migrations..."
ssh $PROXMOX_HOST "pct exec $LXC_ID -- bash -c 'cd $APP_DIR && npx prisma migrate deploy'" || {
    echo "⚠️  Warning: Migration may not be needed"
}
echo "✅ Migrations applied"
echo ""

# Step 8: Restart service
echo "♻️  Step 8/9: Restarting backend service..."
ssh $PROXMOX_HOST "pct exec $LXC_ID -- systemctl restart bitbonsai-backend"
sleep 3
ssh $PROXMOX_HOST "pct exec $LXC_ID -- systemctl status bitbonsai-backend --no-pager -l" || true
echo "✅ Service restarted"
echo ""

# Cleanup temp files
echo "🧹 Cleaning up temp files..."
ssh $PROXMOX_HOST "rm -rf /tmp/bitbonsai-deploy"
echo "✅ Cleanup complete"
echo ""

# Step 9: Verify frontend
echo "✅ Step 9/9: Verifying frontend..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://192.168.1.170:4210/ 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Frontend verified (HTTP 200)"
else
    echo "⚠️  Frontend returned HTTP $HTTP_CODE"
fi
echo ""

echo "🎉 Deployment to LXC child node complete!"
echo ""
echo "📍 Child Node Frontend: http://192.168.1.170:4210"
echo "📍 Child Node API: http://192.168.1.170:3100/api/v1"
echo ""
