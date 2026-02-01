#!/bin/bash
#
# BitBonsai - Deploy Child Node to LXC Container
#
# This script deploys a BitBonsai worker node to an LXC container on Proxmox.
# The child node connects to the main node's PostgreSQL database via network.
#
# Prerequisites:
# - Proxmox host accessible via SSH
# - LXC container created with Debian/Ubuntu
# - NFS exports configured on Unraid for shared media access
# - Main node running and accessible
#
# Usage:
#   ./scripts/deploy-child-lxc.sh [options]
#
# Options:
#   --proxmox HOST    Proxmox hostname (default: pve-labg5)
#   --lxc-id ID       LXC container ID (default: 300)
#   --main-node URL   Main node API URL (default: http://192.168.1.100:3100)
#   --skip-nfs        Skip NFS mount setup
#   --rebuild         Force rebuild even if no changes
#

set -e

# ============================================================================
# CONFIGURATION
# ============================================================================

PROXMOX_HOST="${PROXMOX_HOST:-pve-labg5}"
LXC_ID="${LXC_ID:-300}"
MAIN_NODE_URL="${MAIN_NODE_URL:-http://192.168.1.100:3100}"
APP_DIR="/opt/bitbonsai"
SERVICE_NAME="bitbonsai-backend"

# NFS Configuration for shared storage
UNRAID_IP="192.168.1.100"
NFS_MOUNTS=(
  "/mnt/user/media:/media:ro"           # Media library (read-only for child)
  "/mnt/cache/bitbonsai-temp:/cache:rw" # Shared encoding cache (read-write)
)

SKIP_NFS=false
FORCE_REBUILD=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --proxmox) PROXMOX_HOST="$2"; shift 2 ;;
    --lxc-id) LXC_ID="$2"; shift 2 ;;
    --main-node) MAIN_NODE_URL="$2"; shift 2 ;;
    --skip-nfs) SKIP_NFS=true; shift ;;
    --rebuild) FORCE_REBUILD=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

log_step() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📍 $1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

pct_exec() {
  ssh "$PROXMOX_HOST" "pct exec $LXC_ID -- $*"
}

pct_exec_bash() {
  ssh "$PROXMOX_HOST" "pct exec $LXC_ID -- bash -c '$*'"
}

# ============================================================================
# MAIN SCRIPT
# ============================================================================

echo ""
echo "🌳 BitBonsai - LXC Child Node Deployment"
echo "========================================="
echo ""
echo "Configuration:"
echo "  Proxmox Host:  $PROXMOX_HOST"
echo "  LXC ID:        $LXC_ID"
echo "  Main Node:     $MAIN_NODE_URL"
echo "  App Directory: $APP_DIR"
echo ""

# Verify LXC container exists and is running
log_step "Step 1: Verifying LXC container"
LXC_STATUS=$(ssh "$PROXMOX_HOST" "pct status $LXC_ID 2>/dev/null | grep -oP 'status: \K\w+'" || echo "error")
if [[ "$LXC_STATUS" != "running" ]]; then
  echo "❌ LXC container $LXC_ID is not running (status: $LXC_STATUS)"
  echo "   Start it with: ssh $PROXMOX_HOST 'pct start $LXC_ID'"
  exit 1
fi
echo "✅ LXC container $LXC_ID is running"

# Setup NFS mounts
if [[ "$SKIP_NFS" != "true" ]]; then
  log_step "Step 2: Setting up NFS mounts"

  # Install NFS client if needed
  pct_exec_bash "which mount.nfs >/dev/null 2>&1 || (apt-get update && apt-get install -y nfs-common)" || true

  for MOUNT_SPEC in "${NFS_MOUNTS[@]}"; do
    IFS=':' read -r HOST_PATH MOUNT_POINT MOUNT_MODE <<< "$MOUNT_SPEC"

    echo "  Mounting $UNRAID_IP:$HOST_PATH → $MOUNT_POINT ($MOUNT_MODE)"

    # Create mount point
    pct_exec mkdir -p "$MOUNT_POINT"

    # Add to fstab if not present
    FSTAB_ENTRY="$UNRAID_IP:$HOST_PATH $MOUNT_POINT nfs $MOUNT_MODE,nolock,soft,intr,timeo=30 0 0"
    pct_exec_bash "grep -q '$UNRAID_IP:$HOST_PATH' /etc/fstab || echo '$FSTAB_ENTRY' >> /etc/fstab"

    # Mount if not already mounted
    if ! pct_exec mountpoint -q "$MOUNT_POINT" 2>/dev/null; then
      pct_exec mount "$MOUNT_POINT" 2>/dev/null || echo "  ⚠️  Could not mount $MOUNT_POINT"
    fi
  done

  # Verify mounts
  echo ""
  echo "  NFS mount status:"
  pct_exec df -h 2>/dev/null | grep -E 'nfs|Filesystem' || true
  echo "✅ NFS setup complete"
else
  echo "⏭️  Skipping NFS setup (--skip-nfs)"
fi

# Install system dependencies
log_step "Step 3: Installing system dependencies"
pct_exec_bash "apt-get update && apt-get install -y curl ffmpeg nodejs npm git" || {
  echo "⚠️  Some packages may have failed, continuing..."
}

# Ensure Node.js 20+
NODE_VERSION=$(pct_exec node --version 2>/dev/null | grep -oP '\d+' | head -1 || echo "0")
if [[ "$NODE_VERSION" -lt 20 ]]; then
  echo "  Upgrading Node.js to v20..."
  pct_exec_bash "curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
fi
echo "✅ Node.js $(pct_exec node --version) installed"

# Sync source code
log_step "Step 4: Syncing source code"
ssh "$PROXMOX_HOST" "mkdir -p /tmp/bitbonsai-deploy"

# Sync essential files only (not node_modules or dist)
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.nx' \
  --exclude '.git' \
  --exclude '*.db' \
  --exclude 'data/' \
  ./apps/backend/ "$PROXMOX_HOST:/tmp/bitbonsai-deploy/apps/backend/"

rsync -az --delete \
  --exclude 'node_modules' \
  ./libs/ "$PROXMOX_HOST:/tmp/bitbonsai-deploy/libs/"

rsync -az \
  ./prisma/ "$PROXMOX_HOST:/tmp/bitbonsai-deploy/prisma/"

rsync -az \
  ./nx.json \
  ./tsconfig.json \
  ./tsconfig.base.json \
  ./package.json \
  ./package-lock.json \
  ./.npmrc \
  "$PROXMOX_HOST:/tmp/bitbonsai-deploy/"

# Copy into LXC container
pct_exec mkdir -p "$APP_DIR"
ssh "$PROXMOX_HOST" "rsync -a --delete /tmp/bitbonsai-deploy/ /var/lib/lxc/$LXC_ID/rootfs$APP_DIR/"
echo "✅ Source code synced"

# Install npm dependencies
log_step "Step 5: Installing npm dependencies"
pct_exec_bash "cd $APP_DIR && npm ci --legacy-peer-deps" || {
  echo "⚠️  npm ci failed, trying npm install..."
  pct_exec_bash "cd $APP_DIR && npm install --legacy-peer-deps"
}
echo "✅ Dependencies installed"

# Generate Prisma client
log_step "Step 6: Generating Prisma client"
pct_exec_bash "cd $APP_DIR && npx prisma generate"
echo "✅ Prisma client generated"

# Build backend
log_step "Step 7: Building backend"
pct_exec_bash "cd $APP_DIR && npx nx build backend --configuration=production --skip-nx-cache"
echo "✅ Backend built"

# Create systemd service
log_step "Step 8: Configuring systemd service"

# Extract host IP from MAIN_NODE_URL for database connection
MAIN_HOST=$(echo "$MAIN_NODE_URL" | sed -E 's|https?://([^:/]+).*|\1|')

# Generate JWT secret if not provided
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"

# Write service file using pct exec (works regardless of storage backend)
ssh "$PROXMOX_HOST" "pct exec $LXC_ID -- tee /etc/systemd/system/$SERVICE_NAME.service > /dev/null" << EOF
[Unit]
Description=BitBonsai Backend (Child Node)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/bitbonsai
Environment=NODE_ENV=production
Environment=NODE_ROLE=LINKED
Environment=MAIN_NODE_URL=$MAIN_NODE_URL
Environment=DATABASE_URL=postgresql://bitbonsai:bitbonsai@$MAIN_HOST:5432/bitbonsai
Environment=JWT_SECRET=$JWT_SECRET
Environment=ENCODING_TEMP_PATH=/cache
ExecStart=/usr/bin/node dist/apps/backend/main.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

pct_exec systemctl daemon-reload
pct_exec systemctl enable "$SERVICE_NAME"
echo "✅ Systemd service configured"

# Restart service
log_step "Step 9: Starting service"
pct_exec systemctl restart "$SERVICE_NAME"
sleep 3

# Check status
if pct_exec systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "✅ Service is running"
  pct_exec systemctl status "$SERVICE_NAME" --no-pager -l | head -20
else
  echo "❌ Service failed to start"
  pct_exec journalctl -u "$SERVICE_NAME" -n 30 --no-pager
  exit 1
fi

# Cleanup
log_step "Step 10: Cleanup"
ssh "$PROXMOX_HOST" "rm -rf /tmp/bitbonsai-deploy"
echo "✅ Cleanup complete"

# Get LXC IP
LXC_IP=$(ssh "$PROXMOX_HOST" "pct exec $LXC_ID -- hostname -I | awk '{print \$1}'" 2>/dev/null || echo "unknown")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Child Node API: http://$LXC_IP:3000/api/v1"
echo "Main Node:      $MAIN_NODE_URL"
echo ""
echo "Next steps:"
echo "  1. Open the main node web UI"
echo "  2. Go to Settings → Nodes"
echo "  3. Approve the pending node registration"
echo ""
echo "Logs: ssh $PROXMOX_HOST 'pct exec $LXC_ID -- journalctl -u $SERVICE_NAME -f'"
echo ""
