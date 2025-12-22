#!/bin/bash
set -e

CHILD_IP="192.168.1.170"
CHILD_USER="root"
APP_DIR="/opt/bitbonsai"

# NFS Configuration - Update these to match your Unraid setup
UNRAID_IP="192.168.1.100"
NFS_EXPORTS=(
  "/mnt/user/media:/media"           # HOST_PATH:MOUNT_POINT
  "/mnt/user/Downloads:/downloads"   # Add more as needed
)

echo "🚀 Deploying BitBonsai to Child Node ($CHILD_IP)..."
echo ""

# Step 0: Setup NFS mounts for shared storage
echo "🔗 Setting up NFS shared storage..."

# Install NFS client if not present
ssh $CHILD_USER@$CHILD_IP "which mount.nfs >/dev/null 2>&1 || (apt-get update && apt-get install -y nfs-common)" || true

for EXPORT in "${NFS_EXPORTS[@]}"; do
  HOST_PATH="${EXPORT%%:*}"
  MOUNT_POINT="${EXPORT##*:}"

  echo "   Mounting $UNRAID_IP:$HOST_PATH → $MOUNT_POINT"

  # Create mount point
  ssh $CHILD_USER@$CHILD_IP "mkdir -p $MOUNT_POINT"

  # Check if already in fstab
  FSTAB_ENTRY="$UNRAID_IP:$HOST_PATH $MOUNT_POINT nfs rw,nolock,soft,intr 0 0"
  ssh $CHILD_USER@$CHILD_IP "grep -q '$UNRAID_IP:$HOST_PATH' /etc/fstab" || \
    ssh $CHILD_USER@$CHILD_IP "echo '$FSTAB_ENTRY' >> /etc/fstab"

  # Mount if not already mounted
  ssh $CHILD_USER@$CHILD_IP "mountpoint -q $MOUNT_POINT" || \
    ssh $CHILD_USER@$CHILD_IP "mount $MOUNT_POINT" || \
    echo "   ⚠️  Warning: Could not mount $MOUNT_POINT (NFS may not be configured on Unraid)"
done

# Verify mounts
echo "   Verifying NFS mounts..."
ssh $CHILD_USER@$CHILD_IP "df -h | grep -E 'nfs|Filesystem'" || true
echo "✅ NFS setup complete"
echo ""

# Sync code to child node
echo "📦 Syncing code..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude 'data' \
  --exclude '.env' \
  apps/ libs/ prisma/ nx.json tsconfig.json package.json package-lock.json angular.json .npmrc \
  $CHILD_USER@$CHILD_IP:$APP_DIR/

# Run deployment commands on child node
echo "🔨 Building and restarting..."
ssh $CHILD_USER@$CHILD_IP "cd $APP_DIR && \
  npm install --production --legacy-peer-deps --ignore-scripts && \
  echo '📦 Rebuilding backend...' && \
  rm -rf dist/ && \
  npx nx build backend --skip-nx-cache && \
  echo '🎨 Building frontend...' && \
  npx nx build frontend --configuration=production && \
  echo '🗄️ Regenerating Prisma Client...' && \
  npx prisma generate && \
  npx prisma migrate deploy && \
  systemctl restart bitbonsai-backend && \
  systemctl reload nginx && \
  echo '✅ Deployment complete!' && \
  sleep 3 && \
  systemctl status bitbonsai-backend --no-pager -l"

echo "🎉 Child node deployment complete!"
echo ""
echo "📍 Frontend: http://$CHILD_IP:4210"
echo "📍 API: http://$CHILD_IP:3100/api/v1"
