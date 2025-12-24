#!/bin/bash
set -e

echo "🚀 BitBonsai License Stack Deployment"
echo "======================================"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ ERROR: .env file not found"
    echo "   Copy .env.example to .env and configure it first:"
    echo "   cp .env.example .env"
    exit 1
fi

# Validate required environment variables
required_vars=(
    "LICENSE_DB_PASSWORD"
    "ENCRYPTION_KEY"
    "ADMIN_API_KEY"
    "STRIPE_SECRET_KEY"
    "STRIPE_WEBHOOK_SECRET"
    "STRIPE_PRODUCT_ID"
    "RESEND_API_KEY"
)

source .env
missing_vars=()

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -gt 0 ]; then
    echo "❌ ERROR: Missing required environment variables:"
    for var in "${missing_vars[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "   Please update your .env file with all required values."
    exit 1
fi

echo "✅ Environment variables validated"
echo ""

# Build images
echo "📦 Building Docker images..."
docker-compose -f docker-compose.license.yml build

echo ""
echo "🚢 Starting services..."
docker-compose -f docker-compose.license.yml up -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check service health
echo ""
echo "🏥 Checking service health..."

if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ License API is healthy"
else
    echo "⚠️  License API health check failed (may still be starting)"
fi

if curl -f http://localhost:4200 > /dev/null 2>&1; then
    echo "✅ Admin Dashboard is healthy"
else
    echo "⚠️  Admin Dashboard health check failed (may still be starting)"
fi

if curl -f http://localhost:4201 > /dev/null 2>&1; then
    echo "✅ Marketing Website is healthy"
else
    echo "⚠️  Marketing Website health check failed (may still be starting)"
fi

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Service URLs:"
echo "   License API:      http://localhost:3000"
echo "   Admin Dashboard:  http://localhost:4200"
echo "   Marketing Website: http://localhost:4201"
echo ""
echo "📊 View logs:"
echo "   docker-compose -f docker-compose.license.yml logs -f"
echo ""
echo "🛑 Stop services:"
echo "   docker-compose -f docker-compose.license.yml down"
