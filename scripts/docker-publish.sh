#!/bin/bash
# 🎬 MediaInsight Docker Hub Publishing Script
# Builds and publishes Docker images with semantic versioning

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DOCKER_USER="lucidfabrics"
DOCKER_REPO="media-insight"
DOCKER_IMAGE="${DOCKER_USER}/${DOCKER_REPO}"

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

echo -e "${GREEN}🎬 MediaInsight Docker Publishing Script${NC}"
echo -e "${YELLOW}Version: ${VERSION}${NC}"
echo ""

# Step 1: Docker login
echo -e "${YELLOW}📦 Logging into Docker Hub...${NC}"
echo "76656SiaPoa@!" | docker login -u "${DOCKER_USER}" --password-stdin

# Step 2: Build the image
echo -e "${YELLOW}🔨 Building Docker image...${NC}"
docker build -f Dockerfile \
  -t "${DOCKER_IMAGE}:latest" \
  -t "${DOCKER_IMAGE}:${VERSION}" \
  -t "${DOCKER_IMAGE}:$(echo ${VERSION} | cut -d. -f1).$(echo ${VERSION} | cut -d. -f2)" \
  -t "${DOCKER_IMAGE}:$(echo ${VERSION} | cut -d. -f1)" \
  .

# Step 3: Push all tags
echo -e "${YELLOW}🚀 Pushing to Docker Hub...${NC}"
docker push "${DOCKER_IMAGE}:latest"
docker push "${DOCKER_IMAGE}:${VERSION}"
docker push "${DOCKER_IMAGE}:$(echo ${VERSION} | cut -d. -f1).$(echo ${VERSION} | cut -d. -f2)"
docker push "${DOCKER_IMAGE}:$(echo ${VERSION} | cut -d. -f1)"

echo ""
echo -e "${GREEN}✅ Successfully published to Docker Hub!${NC}"
echo -e "${GREEN}   - ${DOCKER_IMAGE}:latest${NC}"
echo -e "${GREEN}   - ${DOCKER_IMAGE}:${VERSION}${NC}"
echo -e "${GREEN}   - ${DOCKER_IMAGE}:$(echo ${VERSION} | cut -d. -f1).$(echo ${VERSION} | cut -d. -f2)${NC}"
echo -e "${GREEN}   - ${DOCKER_IMAGE}:$(echo ${VERSION} | cut -d. -f1)${NC}"
echo ""
echo -e "${YELLOW}📝 Docker Hub: https://hub.docker.com/r/${DOCKER_USER}/${DOCKER_REPO}${NC}"
