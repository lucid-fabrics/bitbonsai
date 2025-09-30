#!/bin/bash
# 🎬 MediaInsight Release Automation Script
# Handles versioning, tagging, Docker building, and publishing

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
BUMP_TYPE="${1:-patch}"  # patch, minor, or major

if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo -e "${RED}❌ Invalid bump type. Use: patch, minor, or major${NC}"
  exit 1
fi

echo -e "${BLUE}🎬 MediaInsight Release Script${NC}"
echo -e "${YELLOW}Bump Type: ${BUMP_TYPE}${NC}"
echo ""

# Step 1: Ensure working directory is clean
echo -e "${YELLOW}🔍 Checking git status...${NC}"
if [[ -n $(git status -s) ]]; then
  echo -e "${RED}❌ Working directory is not clean. Commit or stash changes first.${NC}"
  git status -s
  exit 1
fi
echo -e "${GREEN}✅ Working directory clean${NC}"
echo ""

# Step 2: Pull latest changes
echo -e "${YELLOW}📥 Pulling latest changes...${NC}"
git pull origin main
echo ""

# Step 3: Run tests (when implemented)
# echo -e "${YELLOW}🧪 Running tests...${NC}"
# npm test
# npm run test:api
# echo ""

# Step 4: Build project
echo -e "${YELLOW}🔨 Building project...${NC}"
npm run build:all
echo -e "${GREEN}✅ Build successful${NC}"
echo ""

# Step 5: Bump version
echo -e "${YELLOW}📦 Bumping version (${BUMP_TYPE})...${NC}"
OLD_VERSION=$(node -p "require('./package.json').version")
npm version ${BUMP_TYPE} --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}✅ Version bumped: ${OLD_VERSION} → ${NEW_VERSION}${NC}"
echo ""

# Step 6: Update Unraid template version
echo -e "${YELLOW}📝 Updating Unraid template...${NC}"
sed -i.bak "s|<Repository>.*</Repository>|<Repository>lucidfabrics/media-insight:${NEW_VERSION}</Repository>|" unraid/media-insight.xml
rm -f unraid/media-insight.xml.bak
echo ""

# Step 7: Git commit and tag
echo -e "${YELLOW}📝 Creating git commit and tag...${NC}"
git add package.json package-lock.json unraid/media-insight.xml
git commit -m "chore: bump version to ${NEW_VERSION}"
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
echo -e "${GREEN}✅ Git commit and tag created${NC}"
echo ""

# Step 8: Build and push Docker image
echo -e "${YELLOW}🐳 Building and publishing Docker image...${NC}"
./scripts/docker-publish.sh
echo ""

# Step 9: Push to GitHub
echo -e "${YELLOW}🚀 Pushing to GitHub...${NC}"
git push origin main
git push origin --tags
echo -e "${GREEN}✅ Pushed to GitHub${NC}"
echo ""

# Summary
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Release ${NEW_VERSION} Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}📦 Published:${NC}"
echo -e "   • Docker Hub: https://hub.docker.com/r/lucidfabrics/media-insight"
echo -e "   • GitHub Tag: v${NEW_VERSION}"
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo -e "   1. Create GitHub Release with changelog"
echo -e "   2. Submit to Unraid Community Applications"
echo -e "   3. Announce release"
echo ""
