#!/bin/bash

# BitBonsai Development Environment Setup
# Automatically configures proxy based on environment

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 BitBonsai Development Setup${NC}"
echo ""

# Function to detect environment
detect_environment() {
  if [ -f ".env.unraid" ]; then
    echo "unraid"
  elif [ -f ".env.docker" ]; then
    echo "docker"
  else
    echo "local"
  fi
}

# Function to set up proxy
setup_proxy() {
  local env=$1
  local proxy_file=""

  case $env in
    "unraid")
      proxy_file="proxy.unraid.conf.json"
      ;;
    "docker")
      proxy_file="proxy.docker.conf.json"
      ;;
    *)
      proxy_file="proxy.local.conf.json"
      ;;
  esac

  echo -e "${GREEN}✓${NC} Environment detected: ${YELLOW}$env${NC}"
  echo -e "${GREEN}✓${NC} Using proxy config: ${YELLOW}$proxy_file${NC}"

  # Copy the appropriate proxy config
  cp "$proxy_file" "proxy.conf.json"
  echo -e "${GREEN}✓${NC} Proxy configuration updated"
}

# Function to update frontend project.json
update_project_config() {
  local env=$1

  if [ "$env" = "unraid" ]; then
    # For Unraid, we might want to serve on all interfaces
    echo -e "${YELLOW}ℹ${NC}  Unraid mode: Frontend will be accessible from network"
  fi
}

# Main setup
ENV=$(detect_environment)

# Check for command-line override
if [ "$1" != "" ]; then
  ENV=$1
  echo -e "${YELLOW}ℹ${NC}  Environment override: $ENV"
fi

setup_proxy "$ENV"
update_project_config "$ENV"

echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""
echo "Available environments:"
echo "  • local  - Development on localhost (default)"
echo "  • unraid - Development with Unraid backend"
echo "  • docker - Docker container environment"
echo ""
echo "To change environment: ./dev-setup.sh [local|unraid|docker]"
echo ""
echo "Next steps:"
echo "  1. Run: npm install (if you haven't already)"
echo "  2. Run: npx nx serve backend  (in one terminal)"
echo "  3. Run: npx nx serve frontend (in another terminal)"
echo ""
