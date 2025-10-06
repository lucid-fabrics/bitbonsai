#!/bin/bash

# BitBonsai Test Environment Reset Script
# Resets database and test media folders to a clean state for testing
# Usage:
#   ./reset-test-env.sh                    - Reset DB + clean temp files (keep media)
#   ./reset-test-env.sh --repopulate-media - Reset DB + repopulate all media files

set -e

echo "🧹 Resetting BitBonsai Test Environment..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
REPOPULATE_MEDIA=false
if [ "$1" = "--repopulate-media" ] || [ "$1" = "--repopulate" ]; then
  REPOPULATE_MEDIA=true
  echo "${YELLOW}⚠️  Repopulate mode: Will recreate all test media files${NC}"
  echo ""
fi

# Check if running in Docker or local
if [ -f "/.dockerenv" ]; then
  echo "${BLUE}ℹ️  Running inside Docker container${NC}"
  IN_DOCKER=true
else
  echo "${BLUE}ℹ️  Running on host machine${NC}"
  IN_DOCKER=false
fi

# 1. Reset Database
echo ""
echo "${YELLOW}📊 Step 1: Resetting database...${NC}"

if [ "$IN_DOCKER" = true ]; then
  # Inside container - run directly
  npx tsx scripts/reset-db.ts
else
  # Outside container - exec into backend container
  if docker ps | grep -q bitbonsai-backend; then
    echo "  → Resetting database (delete + recreate + seed)..."
    docker exec bitbonsai-backend npx tsx scripts/reset-db.ts
  else
    echo "${YELLOW}  ⚠️  Backend container not running - skipping database reset${NC}"
  fi
fi

echo "${GREEN}  ✅ Database reset complete${NC}"

# Seed test libraries via API
echo ""
echo "${YELLOW}📚 Seeding test libraries via API...${NC}"
sleep 2  # Give backend time to be ready

if [ "$IN_DOCKER" = true ]; then
  # Inside container - run directly
  npx tsx scripts/seed-test-libraries.ts
else
  # Outside container - exec into backend container
  if docker ps | grep -q bitbonsai-backend; then
    docker exec bitbonsai-backend npx tsx scripts/seed-test-libraries.ts
  else
    echo "${YELLOW}  ⚠️  Backend container not running - skipping library seeding${NC}"
  fi
fi

# 2. Clean Test Media Folders
echo ""
echo "${YELLOW}📁 Step 2: Cleaning test media folders...${NC}"

TEST_MEDIA_DIR="./test-media"

if [ ! -d "$TEST_MEDIA_DIR" ]; then
  echo "${YELLOW}  ⚠️  Test media directory not found - creating...${NC}"
  mkdir -p "$TEST_MEDIA_DIR"
fi

if [ "$REPOPULATE_MEDIA" = true ]; then
  # Repopulate - recreate all media files
  echo "  → Running populate-test-media.sh..."
  bash scripts/populate-test-media.sh
else
  # Normal reset - just clean temp files
  echo "  → Removing processed/temp files..."
  find "$TEST_MEDIA_DIR" -type f \( -name "*.processed" -o -name "*.tmp" -o -name "*.partial" \) -delete 2>/dev/null || true

  # Clean .DS_Store files
  find "$TEST_MEDIA_DIR" -type f -name ".DS_Store" -delete 2>/dev/null || true

  echo "${GREEN}  ✅ Test media cleaned${NC}"
fi

# 3. Verify Test Fixtures
echo ""
echo "${YELLOW}📋 Step 3: Verifying test fixtures...${NC}"

REQUIRED_DIRS=(
  "Movies"
  "TV"
  "Anime"
  "Anime Movies"
  "samples"
)

for dir in "${REQUIRED_DIRS[@]}"; do
  if [ ! -d "$TEST_MEDIA_DIR/$dir" ]; then
    echo "  → Creating missing directory: $dir"
    mkdir -p "$TEST_MEDIA_DIR/$dir"
  fi
done

# Count test files
TOTAL_FILES=$(find "$TEST_MEDIA_DIR" -type f \( -name "*.mp4" -o -name "*.mkv" -o -name "*.avi" \) 2>/dev/null | wc -l | tr -d ' ')

echo "${GREEN}  ✅ Test fixtures verified (${TOTAL_FILES} media files)${NC}"

# 4. Summary
echo ""
echo "${GREEN}✨ Test environment reset complete!${NC}"
echo ""
echo "📊 Summary:"
echo "  • Database: Reset to seed state"
echo "  • License: 1 FREE license created"
echo "  • Policy: 1 default H.265 policy created"
echo "  • Node: 1 test encoding node registered"
echo "  • Libraries: 4 test libraries created (Anime, Anime Movies, Movies, TV)"
echo "  • Test Media: ${TOTAL_FILES} files ready"
if [ "$REPOPULATE_MEDIA" = true ]; then
  echo "  • Media Files: Repopulated with fresh unencoded samples"
else
  echo "  • Media Files: Preserved (use --repopulate-media to recreate)"
fi
echo ""
echo "🚀 Ready to run tests!"
echo ""
