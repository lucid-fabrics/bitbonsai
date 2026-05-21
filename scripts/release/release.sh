#!/bin/bash
set -e

VERSION_TYPE="${1:-patch}"  # patch, minor, major
DRY_RUN="${2:-false}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_FILE="$SCRIPT_DIR/.version-backup"

cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Pre-flight checks
check_working_directory() {
  if [[ -n $(git status --porcelain) ]]; then
    echo -e "${RED}❌ Working directory not clean. Commit or stash changes first.${NC}"
    exit 1
  fi
}

check_prerequisites() {
  if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found. Please install Node.js.${NC}"
    exit 1
  fi

  if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ git not found. Please install git.${NC}"
    exit 1
  fi
}

# Backup current version
backup_version() {
  CURRENT_VERSION=$(node -p "require('./package.json').version")
  echo "$CURRENT_VERSION" > "$BACKUP_FILE"
  echo -e "${BLUE}📦 Backed up version: ${CURRENT_VERSION}${NC}"
}

# Bump version
bump_version() {
  npm version "$VERSION_TYPE" --no-git-tag-version > /dev/null 2>&1
  NEW_VERSION=$(node -p "require('./package.json').version")
  echo -e "${GREEN}⬆️  Bumped version: ${CURRENT_VERSION} → ${NEW_VERSION}${NC}"
}

# Build releases
build_releases() {
  echo -e "${BLUE}🏗️  Building Unraid release...${NC}"
  bash "$SCRIPT_DIR/build-unraid.sh" || rollback_on_error "Unraid build failed"

  echo -e "${BLUE}🏗️  Building Proxmox release...${NC}"
  bash "$SCRIPT_DIR/build-proxmox.sh" || rollback_on_error "Proxmox build failed"
}

# Validate releases
validate_releases() {
  echo -e "${BLUE}✅ Validating releases...${NC}"
  bash "$SCRIPT_DIR/validate-release.sh" || rollback_on_error "Validation failed"
}

# Rollback on error
rollback_on_error() {
  ERROR_MSG="$1"
  echo -e "${RED}❌ ERROR: ${ERROR_MSG}${NC}"
  echo -e "${YELLOW}🔄 Rolling back version...${NC}"
  bash "$SCRIPT_DIR/rollback-version.sh" --silent
  exit 1
}

# Commit and tag
commit_and_tag() {
  git add -A
  git commit -m "chore(release): v${NEW_VERSION}

- Unraid Community Applications release
- Proxmox VE Community Scripts release
- Updated version across all platforms

Release includes:
- Updated package.json to v${NEW_VERSION}
- Generated Unraid release package
- Generated Proxmox release package
- Validated all release artifacts"

  git tag "v${NEW_VERSION}"
  echo -e "${GREEN}✅ Created git tag: v${NEW_VERSION}${NC}"
}

# Main execution
main() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}🚀 BitBonsai Unified Release${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  check_prerequisites
  check_working_directory
  backup_version
  bump_version
  build_releases
  validate_releases

  if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    echo -e "${YELLOW}🏁 Dry run complete. Changes not committed.${NC}"
    echo -e "${YELLOW}🔄 Rolling back changes...${NC}"
    bash "$SCRIPT_DIR/rollback-version.sh" --silent
    rm -f "$BACKUP_FILE"
    exit 0
  fi

  commit_and_tag
  rm -f "$BACKUP_FILE"

  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}✅ Release v${NEW_VERSION} complete!${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "${YELLOW}Next steps:${NC}"
  echo "  1. Review changes: ${BLUE}git show${NC}"
  echo "  2. Push to remote: ${BLUE}git push && git push --tags${NC}"
  echo "  3. Build Docker images: ${BLUE}npx nx docker:build-push${NC}"
  echo "  4. Submit to Unraid CA"
  echo "  5. Submit to Proxmox VE Community Scripts"
  echo ""
}

main
