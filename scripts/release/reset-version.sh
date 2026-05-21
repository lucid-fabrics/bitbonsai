#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

TARGET_VERSION="$1"

if [[ -z "$TARGET_VERSION" ]]; then
  echo "Usage: npx nx release:reset <version>"
  echo ""
  echo "Example:"
  echo "  npx nx release:reset 1.0.0"
  echo ""
  exit 1
fi

# Validate version format (basic check)
if ! [[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ Invalid version format. Use semantic versioning (e.g., 1.0.0)"
  exit 1
fi

echo "⚠️  Resetting version to: $TARGET_VERSION"
echo ""
read -p "Are you sure? This will modify package.json (y/N): " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Cancelled"
  exit 0
fi

# Update package.json
npm version "$TARGET_VERSION" --no-git-tag-version --allow-same-version > /dev/null 2>&1

# Update environment files (if script exists)
if [[ -f "scripts/update-version.js" ]]; then
  node scripts/update-version.js
fi

echo "✅ Version reset to: $TARGET_VERSION"
echo ""
echo "Next steps:"
echo "  1. Rebuild releases: npx nx release:dry-run"
echo "  2. Commit changes: git add . && git commit -m 'chore: reset version to $TARGET_VERSION'"
