#!/bin/bash
set -e

echo "=========================================="
echo "Deploying BitBonsai Application"
echo "=========================================="
echo ""

cd /opt/bitbonsai

# Install dependencies
echo "[1/6] Installing dependencies..."
npm install --production

# Generate Prisma Client
echo "[2/6] Generating Prisma Client..."
npx prisma generate

# Run database migrations
echo "[3/6] Running database migrations..."
npx prisma migrate deploy

# Build frontend
echo "[4/6] Building frontend..."
npx nx build frontend --prod

# Build backend
echo "[5/6] Building backend..."
npx nx build backend --prod

# Fix permissions
echo "[6/6] Setting permissions..."
chown -R bitbonsai:bitbonsai /opt/bitbonsai

echo ""
echo "=========================================="
echo "Application deployed successfully!"
echo "=========================================="
