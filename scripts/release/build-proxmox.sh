#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

echo "   Updating Proxmox release to v${VERSION}..."

# Update version in install script
if [ -f "proxmox-release/bitbonsai-install.sh" ]; then
  # Use platform-agnostic sed
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/BITBONSAI_VERSION=\".*\"/BITBONSAI_VERSION=\"v${VERSION}\"/" proxmox-release/bitbonsai-install.sh
  else
    sed -i "s/BITBONSAI_VERSION=\".*\"/BITBONSAI_VERSION=\"v${VERSION}\"/" proxmox-release/bitbonsai-install.sh
  fi
fi

# Make script executable
chmod +x proxmox-release/bitbonsai-install.sh

# Create release metadata
mkdir -p proxmox-release
cat > proxmox-release/release-info.json <<EOF
{
  "version": "${VERSION}",
  "releaseDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "platform": "proxmox",
  "script": "bitbonsai-install.sh",
  "repository": "https://github.com/wassimmehanna/bitbonsai",
  "communityScripts": "https://github.com/community-scripts/ProxmoxVE"
}
EOF

echo "   ✅ Proxmox release v${VERSION} built successfully"
