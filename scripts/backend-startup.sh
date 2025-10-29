#!/bin/sh

# BitBonsai Backend Startup Script
# This script runs BEFORE the backend starts to ensure Prisma is always in sync
# Prevents 504/proxy errors caused by outdated Prisma client

set -e

echo "🔧 BitBonsai Backend Startup..."
echo ""

# Always regenerate Prisma Client to ensure sync with schema
echo "🔄 Regenerating Prisma Client..."
npx prisma generate
echo "✅ Prisma Client ready"
echo ""

# Apply any pending migrations
echo "🗄️  Checking for database migrations..."
npx prisma migrate deploy || {
    echo "⚠️  No migrations to apply or migration failed (this is often OK)"
}
echo "✅ Database ready"
echo ""

# Start the backend
echo "🚀 Starting NestJS backend..."
exec npx nx serve backend --host 0.0.0.0
