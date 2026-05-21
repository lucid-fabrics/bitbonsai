#!/bin/bash
#
# Update Child Node with Latest Code
# Run this script ON the child node (192.168.1.170)
#

set -e

echo "=========================================="
echo "Updating BitBonsai Child Node"
echo "=========================================="

# Find BitBonsai installation
if [ -d "/opt/bitbonsai" ]; then
  INSTALL_DIR="/opt/bitbonsai"
elif [ -d "/mnt/user/appdata/bitbonsai-dev" ]; then
  INSTALL_DIR="/mnt/user/appdata/bitbonsai-dev"
else
  echo "❌ Error: BitBonsai installation not found"
  echo "Checked: /opt/bitbonsai, /mnt/user/appdata/bitbonsai-dev"
  exit 1
fi

echo "📍 Installation found: $INSTALL_DIR"
echo ""

# Backup current version
echo "💾 Creating backup..."
cp -r "$INSTALL_DIR/dist" "$INSTALL_DIR/dist.backup.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true

# Restart containers to pick up new code
echo "♻️  Restarting containers..."
cd "$INSTALL_DIR"

if [ -f "docker-compose.yml" ]; then
  docker-compose restart backend frontend
elif [ -f "docker-compose.unraid.yml" ]; then
  docker-compose -f docker-compose.unraid.yml restart backend frontend
else
  # Try generic docker restart
  docker restart bitbonsai-backend bitbonsai-frontend 2>/dev/null || \
  docker restart $(docker ps -q --filter "name=bitbonsai") 2>/dev/null || \
  echo "⚠️  Could not auto-restart containers. Please restart manually."
fi

echo ""
echo "✅ Update complete!"
echo ""
echo "🔍 Verify the update:"
echo "   curl http://localhost:3100/api/v1/nodes/current"
echo ""
echo "   Should include: \"mainNodeUrl\": \"http://192.168.1.100:3100/api/v1\""
echo "=========================================="
