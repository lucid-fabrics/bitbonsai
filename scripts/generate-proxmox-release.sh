#!/bin/bash
set -e

echo "=========================================="
echo "BitBonsai Proxmox VE Release Generator"
echo "=========================================="

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
echo "Version: $VERSION"
echo ""

# Create release directory
mkdir -p proxmox-release
cd proxmox-release

# Update version in install script
echo "[1/3] Updating version in installation script..."
sed -i.bak "s/BITBONSAI_VERSION=\".*\"/BITBONSAI_VERSION=\"v${VERSION}\"/" bitbonsai-install.sh
rm bitbonsai-install.sh.bak 2>/dev/null || true
echo "   Version updated to: v${VERSION}"

# Make script executable
echo "[2/3] Setting executable permissions..."
chmod +x bitbonsai-install.sh

# Create metadata file
echo "[3/3] Creating release metadata..."
cat > release-info.json <<EOF
{
  "version": "${VERSION}",
  "releaseDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "script": "bitbonsai-install.sh",
  "repository": "https://github.com/wassimmehanna/bitbonsai",
  "communityScripts": "https://github.com/community-scripts/ProxmoxVE"
}
EOF

cd ..

echo ""
echo "=========================================="
echo "Release package generated!"
echo "=========================================="
echo "Location: ./proxmox-release/"
echo ""
echo "Files:"
echo "  - bitbonsai-install.sh (installation script)"
echo "  - release-info.json (metadata)"
echo ""
echo "Next steps:"
echo "1. Test installation:"
echo "   bash proxmox-release/bitbonsai-install.sh"
echo ""
echo "2. Submit to Proxmox VE Community Scripts:"
echo "   See PROXMOX-DEPLOYMENT.md for submission guide"
echo ""
echo "=========================================="
