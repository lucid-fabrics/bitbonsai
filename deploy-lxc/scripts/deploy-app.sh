#!/bin/bash
set -e

echo "=========================================="
echo "Deploying BitBonsai Application"
echo "=========================================="
echo ""

cd /opt/bitbonsai

# Create .env file with required environment variables
echo "[1/7] Creating environment configuration..."
if [ ! -f .env ]; then
  echo "DATABASE_URL=file:/opt/bitbonsai/data/bitbonsai.db" > .env
  echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
  echo "PORT=3100" >> .env
  echo "NODE_ENV=production" >> .env
  echo "✓ Created .env file"
else
  # Ensure JWT_SECRET exists
  if ! grep -q "JWT_SECRET" .env; then
    echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
    echo "✓ Added JWT_SECRET to existing .env"
  fi
  # Ensure DATABASE_URL exists
  if ! grep -q "DATABASE_URL" .env; then
    echo "DATABASE_URL=file:/opt/bitbonsai/data/bitbonsai.db" >> .env
    echo "✓ Added DATABASE_URL to existing .env"
  fi
  echo "✓ Environment file configured"
fi

# Install production dependencies only
echo "[2/7] Installing production dependencies..."
npm install --production --legacy-peer-deps --ignore-scripts

# Generate Prisma Client
echo "[3/7] Generating Prisma Client..."
npx prisma generate

# Run database migrations
echo "[4/7] Running database migrations..."
npx prisma migrate deploy

# Fix frontend directory structure (Nx outputs to dist/apps/frontend)
echo "[5/7] Fixing frontend directory structure..."
if [ -d "dist/apps/frontend" ]; then
  mkdir -p dist/frontend
  rm -rf dist/frontend/browser
  mv dist/apps/frontend dist/frontend/browser
  echo "✓ Moved frontend files to dist/frontend/browser/"
fi

# Create data directory for database
echo "[6/7] Ensuring database directory exists..."
mkdir -p data
chown -R bitbonsai:bitbonsai data

# Fix permissions
echo "[7/10] Setting permissions..."
chown -R bitbonsai:bitbonsai /opt/bitbonsai

# Create systemd service for backend
echo "[8/10] Creating backend systemd service..."
cat > /etc/systemd/system/bitbonsai-backend.service <<'EOF'
[Unit]
Description=BitBonsai Backend API
After=network.target

[Service]
Type=simple
User=bitbonsai
WorkingDirectory=/opt/bitbonsai
EnvironmentFile=/opt/bitbonsai/.env
ExecStart=/usr/bin/node dist/apps/backend/main.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Create systemd service for frontend
echo "[9/10] Creating frontend systemd service..."
# Create frontend service (using localhost for backend proxy - future-proof)
cat > /etc/systemd/system/bitbonsai-frontend.service <<EOF
[Unit]
Description=BitBonsai Frontend Web Server
After=network.target bitbonsai-backend.service

[Service]
Type=simple
User=bitbonsai
WorkingDirectory=/opt/bitbonsai
ExecStart=/usr/bin/npx http-server dist/frontend/browser -p 3000 -a 0.0.0.0 --proxy http://localhost:3100? --spa
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable services
echo "[10/10] Enabling and starting services..."
systemctl daemon-reload
systemctl enable bitbonsai-backend bitbonsai-frontend
systemctl restart bitbonsai-backend bitbonsai-frontend

echo ""
echo "=========================================="
echo "Application deployed successfully!"
echo ""
echo "Services:"
echo "  - Backend:  systemctl status bitbonsai-backend"
echo "  - Frontend: systemctl status bitbonsai-frontend"
echo ""
echo "Access:"
echo "  - Frontend: http://<ip>:3000"
echo "  - API:      http://<ip>:3100/api/v1"
echo "=========================================="
