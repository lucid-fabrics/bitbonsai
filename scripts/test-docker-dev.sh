#!/bin/bash
set -e

echo "🔍 Testing BitBonsai Docker Development Setup..."
echo ""

# Check if Docker is running
echo "1. Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop."
    exit 1
fi
echo "✅ Docker is running"
echo ""

# Check if docker-compose exists
echo "2. Checking docker-compose..."
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose not found. Installing..."
    # Docker Desktop includes docker-compose, try docker compose instead
    if docker compose version &> /dev/null; then
        echo "✅ Using 'docker compose' (V2)"
        alias docker-compose='docker compose'
    else
        echo "❌ Neither docker-compose nor 'docker compose' found"
        exit 1
    fi
else
    echo "✅ docker-compose found"
fi
echo ""

# Check if required files exist
echo "3. Checking required files..."
required_files=(
    "docker-compose.dev.yml"
    "Dockerfile.dev"
    "package.json"
    "nx.json"
)

for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Missing: $file"
        exit 1
    fi
    echo "✅ Found: $file"
done
echo ""

# Validate docker-compose.dev.yml
echo "4. Validating docker-compose.dev.yml..."
if docker-compose -f docker-compose.dev.yml config > /dev/null 2>&1; then
    echo "✅ docker-compose.dev.yml is valid"
else
    echo "❌ docker-compose.dev.yml has errors:"
    docker-compose -f docker-compose.dev.yml config
    exit 1
fi
echo ""

# Check for test-media directory (optional)
echo "5. Checking optional directories..."
if [ ! -d "test-media" ]; then
    echo "⚠️  test-media directory not found (creating empty placeholder)"
    mkdir -p test-media
else
    echo "✅ test-media directory exists"
fi
echo ""

echo "✅ All checks passed! Ready to run:"
echo ""
echo "   npx nx run bitbonsai:docker:dev"
echo ""
echo "Or directly:"
echo ""
echo "   docker-compose -f docker-compose.dev.yml up --build"
echo ""
