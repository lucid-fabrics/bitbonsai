#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

echo "   Updating Unraid release to v${VERSION}..."

# Update version in XML (if needed)
# Currently the XML doesn't have a version field, but we generate metadata

# Create release metadata
mkdir -p unraid-release
cat > unraid-release/release-info.json <<EOF
{
  "version": "${VERSION}",
  "releaseDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "platform": "unraid",
  "template": "bitbonsai.xml",
  "repository": "https://github.com/wassimmehanna/bitbonsai",
  "communityApps": "https://github.com/Squidly271/docker-templates"
}
EOF

echo "   ✅ Unraid release v${VERSION} built successfully"
