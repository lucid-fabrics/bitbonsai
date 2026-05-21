#!/bin/bash
#
# Configure a LINKED node's frontend to point to the MAIN node's API
#
# Usage:
#   ./configure-linked-node.sh <main_api_url>
#
# Example:
#   ./configure-linked-node.sh http://192.168.1.100:3100/api/v1
#

set -e

MAIN_API_URL="$1"

if [ -z "$MAIN_API_URL" ]; then
  echo "Error: Main API URL is required"
  echo "Usage: $0 <main_api_url>"
  echo "Example: $0 http://192.168.1.100:3100/api/v1"
  exit 1
fi

INDEX_HTML="/opt/bitbonsai/dist/frontend/browser/index.html"

if [ ! -f "$INDEX_HTML" ]; then
  echo "Error: index.html not found at $INDEX_HTML"
  echo "Make sure BitBonsai is deployed first"
  exit 1
fi

echo "=========================================="
echo "Configuring LINKED Node Frontend"
echo "=========================================="
echo "Main API URL: $MAIN_API_URL"
echo ""

# Check if meta tag already exists
if grep -q 'name="main-api-url"' "$INDEX_HTML"; then
  echo "⚠️  Main API URL meta tag already exists, removing old one..."
  sed -i.bak '/<meta name="main-api-url"/d' "$INDEX_HTML"
fi

# Inject meta tag into <head>
echo "📝 Injecting main-api-url meta tag into index.html..."
sed -i.bak "s|<head>|<head>\n  <meta name=\"main-api-url\" content=\"$MAIN_API_URL\">|" "$INDEX_HTML"

# Verify injection
if grep -q "main-api-url" "$INDEX_HTML"; then
  echo "✅ Configuration successful!"
  echo ""
  echo "Frontend will now query: $MAIN_API_URL"
  echo ""
  echo "Restart frontend service to apply changes:"
  echo "  systemctl restart bitbonsai-frontend"
else
  echo "❌ Configuration failed!"
  exit 1
fi

echo "=========================================="
