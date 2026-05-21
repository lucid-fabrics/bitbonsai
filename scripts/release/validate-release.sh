#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ERRORS=0

# Get package version
PACKAGE_VERSION=$(node -p "require('./package.json').version")

echo "   Validating releases for v${PACKAGE_VERSION}..."

# Validate Unraid release
if [[ ! -f "unraid-release/bitbonsai.xml" ]]; then
  echo -e "   ${RED}❌ Unraid XML not found${NC}"
  ERRORS=$((ERRORS + 1))
fi

if [[ ! -f "unraid-release/release-info.json" ]]; then
  echo -e "   ${RED}❌ Unraid release metadata not found${NC}"
  ERRORS=$((ERRORS + 1))
else
  UNRAID_VERSION=$(node -p "require('./unraid-release/release-info.json').version" 2>/dev/null || echo "")
  if [[ "$PACKAGE_VERSION" != "$UNRAID_VERSION" ]]; then
    echo -e "   ${RED}❌ Unraid version mismatch: ${PACKAGE_VERSION} != ${UNRAID_VERSION}${NC}"
    ERRORS=$((ERRORS + 1))
  fi
fi

# Validate Proxmox release
if [[ ! -f "proxmox-release/bitbonsai-install.sh" ]]; then
  echo -e "   ${RED}❌ Proxmox install script not found${NC}"
  ERRORS=$((ERRORS + 1))
fi

if [[ ! -x "proxmox-release/bitbonsai-install.sh" ]]; then
  echo -e "   ${RED}❌ Proxmox script not executable${NC}"
  ERRORS=$((ERRORS + 1))
fi

if [[ ! -f "proxmox-release/release-info.json" ]]; then
  echo -e "   ${RED}❌ Proxmox release metadata not found${NC}"
  ERRORS=$((ERRORS + 1))
else
  PROXMOX_VERSION=$(node -p "require('./proxmox-release/release-info.json').version" 2>/dev/null || echo "")
  if [[ "$PACKAGE_VERSION" != "$PROXMOX_VERSION" ]]; then
    echo -e "   ${RED}❌ Proxmox version mismatch: ${PACKAGE_VERSION} != ${PROXMOX_VERSION}${NC}"
    ERRORS=$((ERRORS + 1))
  fi
fi

# Validate Proxmox script syntax
if command -v bash &> /dev/null; then
  bash -n proxmox-release/bitbonsai-install.sh 2>/dev/null || {
    echo -e "   ${RED}❌ Proxmox script has syntax errors${NC}"
    ERRORS=$((ERRORS + 1))
  }
fi

if [[ $ERRORS -eq 0 ]]; then
  echo -e "   ${GREEN}✅ All validations passed${NC}"
  exit 0
else
  echo -e "   ${RED}❌ Validation failed with ${ERRORS} error(s)${NC}"
  exit 1
fi
