#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_FILE="$SCRIPT_DIR/.version-backup"
SILENT="${1:-false}"

cd "$PROJECT_ROOT"

if [[ ! -f "$BACKUP_FILE" ]]; then
  if [[ "$SILENT" != "--silent" ]]; then
    echo "❌ No version backup found"
  fi
  exit 1
fi

BACKUP_VERSION=$(cat "$BACKUP_FILE")

if [[ "$SILENT" != "--silent" ]]; then
  echo "🔄 Rolling back to version: $BACKUP_VERSION"
fi

# Restore version in package.json
npm version "$BACKUP_VERSION" --no-git-tag-version --allow-same-version > /dev/null 2>&1

# Clean up generated files
rm -f unraid-release/release-info.json
rm -f proxmox-release/release-info.json

# Restore git state if needed
git checkout -- package.json unraid-release/ proxmox-release/ 2>/dev/null || true

if [[ "$SILENT" != "--silent" ]]; then
  echo "✅ Rollback complete"
fi
