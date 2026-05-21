#!/bin/bash
set -e

echo "🌳 BitBonsai Website Deploy"
echo "=============================="

# Build website
echo "Building website..."
npx nx build website --configuration=production

if [ ! -d "dist/apps/website/browser" ]; then
  echo "❌ Build failed - output directory not found"
  exit 1
fi

echo "✓ Build complete: dist/apps/website/browser"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
  echo ""
  echo "⚠️  Wrangler CLI not found"
  echo "Install: npm install -g wrangler"
  echo ""
  echo "Alternative: Deploy via Cloudflare dashboard"
  echo "1. Go to dash.cloudflare.com"
  echo "2. Pages → bitbonsai-website → Upload"
  echo "3. Upload: dist/apps/website/browser"
  exit 1
fi

# Deploy to Cloudflare Pages
echo ""
echo "Deploying to Cloudflare Pages..."
wrangler pages deploy dist/apps/website/browser \
  --project-name=bitbonsai-website \
  --branch=main

echo ""
echo "✓ Deployment complete!"
echo "Site: https://bitbonsai.app"
