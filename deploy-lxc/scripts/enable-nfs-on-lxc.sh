#!/bin/bash
#
# Enable NFS mounting support on existing BitBonsai LXC containers
#
# This script must be run on the Proxmox host (not inside the container)
#
# Usage:
#   ./enable-nfs-on-lxc.sh <container_id>
#
# Example:
#   ./enable-nfs-on-lxc.sh 200
#

set -e

CONTAINER_ID="$1"

if [ -z "$CONTAINER_ID" ]; then
  echo "Error: Container ID is required"
  echo "Usage: $0 <container_id>"
  echo "Example: $0 200"
  exit 1
fi

# Check if running on Proxmox
if [ ! -f /etc/pve/.version ]; then
  echo "Error: This script must be run on a Proxmox host, not inside a container"
  echo "Please run this on your Proxmox server (pve-mirna, pve-ai, etc.)"
  exit 1
fi

# Check if container exists
if ! pct status "$CONTAINER_ID" &>/dev/null; then
  echo "Error: Container $CONTAINER_ID not found"
  echo "Available containers:"
  pct list
  exit 1
fi

echo "=========================================="
echo "Enabling NFS Support on LXC Container"
echo "=========================================="
echo "Container ID: $CONTAINER_ID"
echo ""

# Get current features
CURRENT_FEATURES=$(pct config "$CONTAINER_ID" | grep "^features:" | cut -d' ' -f2-)
echo "Current features: ${CURRENT_FEATURES:-none}"

# Check if mount=nfs is already enabled
if echo "$CURRENT_FEATURES" | grep -q "mount=nfs"; then
  echo "✅ NFS mounting already enabled on container $CONTAINER_ID"
  exit 0
fi

# Add NFS mount support
echo "📝 Adding NFS mount support..."

# Build new features string
if [ -z "$CURRENT_FEATURES" ]; then
  NEW_FEATURES="nesting=1,fuse=1,mount=nfs"
else
  # Add to existing features
  NEW_FEATURES="${CURRENT_FEATURES},fuse=1,mount=nfs"
fi

# Apply new features
pct set "$CONTAINER_ID" --features "$NEW_FEATURES"

echo "✅ NFS support enabled successfully"
echo ""
echo "New features: $NEW_FEATURES"
echo ""
echo "⚠️  Container must be restarted for changes to take effect:"
echo "   pct reboot $CONTAINER_ID"
echo ""
echo "Or restart manually:"
echo "   pct stop $CONTAINER_ID && pct start $CONTAINER_ID"
echo "=========================================="
