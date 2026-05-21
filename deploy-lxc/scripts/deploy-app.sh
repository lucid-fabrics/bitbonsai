#!/bin/bash
set -e

echo "=========================================="
echo "Deploying BitBonsai Application"
echo "=========================================="
echo ""

cd /opt/bitbonsai

# Install storage client tools for shared storage support
echo "[1/11] Installing NFS and SMB client tools..."
apt-get update -qq
apt-get install -y -qq nfs-common cifs-utils > /dev/null 2>&1

# Create shared mount directory
mkdir -p /mnt/shared

# Enable kernel modules for NFS and SMB
modprobe nfs || true
modprobe cifs || true

# Ensure modules load on boot
echo "nfs" >> /etc/modules 2>/dev/null || true
echo "cifs" >> /etc/modules 2>/dev/null || true

echo "✓ Storage tools installed and ready"

# Create .env file with required environment variables
echo "[2/11] Creating environment configuration..."
if [ ! -f .env ]; then
  echo "DATABASE_URL=file:/opt/bitbonsai/data/bitbonsai.db" > .env
  echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
  echo "PORT=3100" >> .env
  echo "NODE_ENV=production" >> .env
  # Configure as LINKED node pointing to MAIN node
  echo "NODE_ROLE=LINKED" >> .env
  echo "MAIN_API_URL=${MAIN_API_URL:-http://192.168.1.100:3100}" >> .env
  echo "✓ Created .env file (configured as LINKED node)"
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
  # Ensure NODE_ROLE exists (configure as LINKED node)
  if ! grep -q "NODE_ROLE" .env; then
    echo "NODE_ROLE=LINKED" >> .env
    echo "✓ Added NODE_ROLE=LINKED to existing .env"
  fi
  # Ensure MAIN_API_URL exists
  if ! grep -q "MAIN_API_URL" .env; then
    echo "MAIN_API_URL=${MAIN_API_URL:-http://192.168.1.100:3100}" >> .env
    echo "✓ Added MAIN_API_URL to existing .env"
  fi
  echo "✓ Environment file configured"
fi

# Install production dependencies only
echo "[3/11] Installing production dependencies..."
npm install --production --legacy-peer-deps --ignore-scripts

# Generate Prisma Client
echo "[4/11] Generating Prisma Client..."
npx prisma generate

# Run database migrations
echo "[5/11] Running database migrations..."
npx prisma migrate deploy

# Fix frontend directory structure (Nx outputs to dist/apps/frontend)
echo "[6/11] Fixing frontend directory structure..."
if [ -d "dist/apps/frontend" ]; then
  mkdir -p dist/frontend
  rm -rf dist/frontend/browser
  mv dist/apps/frontend dist/frontend/browser
  echo "✓ Moved frontend files to dist/frontend/browser/"
fi

# Configure main API URL and current node ID for LINKED nodes (if provided)
if [ -n "$MAIN_API_URL" ]; then
  echo "[6.1/11] Configuring LINKED node to point to main API..."
  INDEX_HTML="dist/frontend/browser/index.html"

  if [ -f "$INDEX_HTML" ]; then
    # Remove existing meta tags if present
    if grep -q 'name="main-api-url"' "$INDEX_HTML"; then
      echo "   Removing existing main-api-url meta tag..."
      sed -i.bak '/<meta name="main-api-url"/d' "$INDEX_HTML"
    fi
    if grep -q 'name="current-node-id"' "$INDEX_HTML"; then
      sed -i.bak '/<meta name="current-node-id"/d' "$INDEX_HTML"
    fi

    # Inject main-api-url meta tag
    sed -i.bak "s|<head>|<head>\n  <meta name=\"main-api-url\" content=\"$MAIN_API_URL\">|" "$INDEX_HTML"

    # Inject current-node-id meta tag if provided
    if [ -n "$CURRENT_NODE_ID" ]; then
      sed -i "s|<head>|<head>\n  <meta name=\"current-node-id\" content=\"$CURRENT_NODE_ID\">|" "$INDEX_HTML"
      echo "   ✓ Frontend configured for node: $CURRENT_NODE_ID"
    fi

    if grep -q "main-api-url" "$INDEX_HTML"; then
      echo "   ✓ Frontend configured to query: $MAIN_API_URL"
    else
      echo "   ⚠️  Failed to inject main-api-url meta tag"
    fi
  fi
fi

# Create data directory for database
echo "[7/11] Ensuring database directory exists..."
mkdir -p data
chown -R bitbonsai:bitbonsai data

# Fix permissions
echo "[8/11] Setting permissions..."
chown -R bitbonsai:bitbonsai /opt/bitbonsai

# Create systemd service for backend
echo "[9/11] Creating backend systemd service..."
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
echo "[10/11] Creating frontend systemd service..."
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
echo "[11/11] Enabling and starting services..."
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
