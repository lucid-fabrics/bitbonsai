#!/bin/bash
set -e

PROXMOX_HOST="${1:-pve-mirna}"
PROXMOX_IP="${2:-192.168.1.2}"
CONTAINER_ID="${3:-200}"
ENVIRONMENT="${4:-dev}"  # dev or prod
STATIC_IP="${5:-}"  # Optional: Static IP in CIDR format (e.g., 192.168.1.162/24)
CONTAINER_HOSTNAME="bitbonsai"

# Load environment-specific specs
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lxc-specs.conf"

# Set specs based on environment
if [ "$ENVIRONMENT" = "prod" ]; then
  CORES=$PROD_CORES
  MEMORY=$PROD_MEMORY
  SWAP=$PROD_SWAP
  STORAGE=$PROD_STORAGE
else
  CORES=$DEV_CORES
  MEMORY=$DEV_MEMORY
  SWAP=$DEV_SWAP
  STORAGE=$DEV_STORAGE
fi

echo "=========================================="
echo "BitBonsai LXC Deployment to Proxmox"
echo "=========================================="
echo "Target: $PROXMOX_HOST ($PROXMOX_IP)"
echo "Container ID: $CONTAINER_ID"
echo "Environment: $(echo $ENVIRONMENT | tr '[:lower:]' '[:upper:]')"
echo "Specs: ${CORES} cores, ${MEMORY}MB RAM, ${STORAGE}GB storage"
if [ -n "$STATIC_IP" ]; then
  echo "Network: Static IP ($STATIC_IP)"
else
  echo "Network: DHCP"
fi
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "deploy-to-proxmox.sh" ]; then
  echo "Error: Must run from deploy-lxc directory"
  exit 1
fi

# Build application locally
echo "[1/7] Building BitBonsai application locally..."
cd ..

# Reset Nx cache to ensure fresh build
echo "   Resetting Nx cache..."
npx nx reset

# Build frontend and backend
echo "   Building frontend..."
npx nx build frontend --prod --skip-nx-cache

echo "   Building backend..."
npx nx build backend --prod

# Package only production artifacts
echo "   Packaging production artifacts..."
tar czf deploy-lxc/app/bitbonsai.tar.gz \
  --exclude='node_modules' \
  dist/ \
  prisma/ \
  package.json \
  package-lock.json \
  .npmrc

cd deploy-lxc

echo "   Package size: $(du -h app/bitbonsai.tar.gz | cut -f1)"

# Copy deployment package to Proxmox
echo "[2/7] Copying deployment package to Proxmox..."
ssh -i ~/.ssh/pve_ai_key root@$PROXMOX_IP "mkdir -p /tmp/bitbonsai-deploy"
scp -i ~/.ssh/pve_ai_key -r * root@$PROXMOX_IP:/tmp/bitbonsai-deploy/

# Create and configure LXC container
echo "[3/7] Creating LXC container..."
ssh -i ~/.ssh/pve_ai_key root@$PROXMOX_IP bash -s $CONTAINER_ID $CORES $MEMORY $SWAP $STORAGE "$STATIC_IP" << 'SCRIPT'
set -e

CONTAINER_ID=$1
CORES=$2
MEMORY=$3
SWAP=$4
STORAGE=$5
STATIC_IP=$6
CONTAINER_HOSTNAME="bitbonsai"
TEMPLATE="local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst"

# Download Ubuntu 24.04 template if not exists
if ! pveam list local | grep -q "ubuntu-24.04-standard"; then
  echo "   Downloading Ubuntu 24.04 LXC template..."
  pveam download local ubuntu-24.04-standard_24.04-2_amd64.tar.zst
fi

# Remove existing container if exists
if pct status $CONTAINER_ID &>/dev/null; then
  echo "   Removing existing container $CONTAINER_ID..."
  pct stop $CONTAINER_ID || true
  pct destroy $CONTAINER_ID || true
fi

# Create new container
echo "   Creating container $CONTAINER_ID..."

# Determine network configuration
if [ -n "$STATIC_IP" ]; then
  # Static IP configuration
  NET_CONFIG="name=eth0,bridge=vmbr0,firewall=1,ip=$STATIC_IP,gw=192.168.1.1"
  DNS_CONFIG="--nameserver 8.8.8.8 --nameserver 8.8.4.4"
  echo "   Using static IP: $STATIC_IP"
else
  # DHCP configuration
  NET_CONFIG="name=eth0,bridge=vmbr0,firewall=1,ip=dhcp"
  DNS_CONFIG=""
  echo "   Using DHCP"
fi

pct create $CONTAINER_ID $TEMPLATE \
  --hostname $CONTAINER_HOSTNAME \
  --cores $CORES \
  --memory $MEMORY \
  --swap $SWAP \
  --storage local-lvm \
  --rootfs local-lvm:$STORAGE \
  --net0 $NET_CONFIG \
  $DNS_CONFIG \
  --features nesting=1 \
  --unprivileged 1 \
  --start 1 \
  --onboot 1

# Wait for container to start
echo "   Waiting for container to start..."
sleep 10

# Wait for network
pct exec $CONTAINER_ID -- bash -c "
  for i in {1..30}; do
    if ping -c 1 8.8.8.8 &>/dev/null; then
      echo '   Network is up'
      break
    fi
    echo '   Waiting for network... (\$i/30)'
    sleep 2
  done
"
SCRIPT

# Install system dependencies
echo "[4/7] Installing system dependencies in container..."
ssh -i ~/.ssh/pve_ai_key root@$PROXMOX_IP bash -s $CONTAINER_ID << 'SCRIPT'
set -e

CONTAINER_ID=$1

# Copy installation script
pct push $CONTAINER_ID /tmp/bitbonsai-deploy/scripts/install.sh /tmp/install.sh

# Run installation
pct exec $CONTAINER_ID -- bash /tmp/install.sh
SCRIPT

# Deploy application
echo "[5/7] Deploying application..."
ssh -i ~/.ssh/pve_ai_key root@$PROXMOX_IP bash -s $CONTAINER_ID << 'SCRIPT'
set -e

CONTAINER_ID=$1

# Extract application
pct push $CONTAINER_ID /tmp/bitbonsai-deploy/app/bitbonsai.tar.gz /opt/bitbonsai.tar.gz
pct exec $CONTAINER_ID -- tar xzf /opt/bitbonsai.tar.gz -C /opt/bitbonsai/
pct exec $CONTAINER_ID -- rm /opt/bitbonsai.tar.gz

# Run deployment script
pct push $CONTAINER_ID /tmp/bitbonsai-deploy/scripts/deploy-app.sh /tmp/deploy-app.sh
pct exec $CONTAINER_ID -- bash /tmp/deploy-app.sh
SCRIPT

# Configure services
echo "[6/7] Configuring systemd services..."
ssh -i ~/.ssh/pve_ai_key root@$PROXMOX_IP bash -s $CONTAINER_ID << 'SCRIPT'
set -e

CONTAINER_ID=$1

# Install backend service
pct push $CONTAINER_ID /tmp/bitbonsai-deploy/config/bitbonsai-backend.service /etc/systemd/system/bitbonsai-backend.service

# Enable and start backend service
pct exec $CONTAINER_ID -- systemctl daemon-reload
pct exec $CONTAINER_ID -- systemctl enable bitbonsai-backend
pct exec $CONTAINER_ID -- systemctl start bitbonsai-backend

# Generate JWT secret
JWT_SECRET=$(openssl rand -base64 32)
pct exec $CONTAINER_ID -- bash -c "echo 'JWT_SECRET=$JWT_SECRET' >> /opt/bitbonsai/.env"
SCRIPT

# Get container IP
echo "[7/7] Getting container information..."
if [ -n "$STATIC_IP" ]; then
  # Extract IP from CIDR notation (e.g., 192.168.1.162/24 -> 192.168.1.162)
  CONTAINER_IP=$(echo "$STATIC_IP" | cut -d'/' -f1)
  echo "Using configured static IP: $CONTAINER_IP"
else
  CONTAINER_IP=$(ssh -i ~/.ssh/pve_ai_key root@$PROXMOX_IP "pct exec $CONTAINER_ID -- hostname -I" | awk '{print $1}')
  echo "Detected DHCP IP: $CONTAINER_IP"
fi

# Health Check
echo ""
echo "=========================================="
echo "Running Health Checks..."
echo "=========================================="

# Wait for services to fully start
echo "⏳ Waiting for services to start (30 seconds)..."
sleep 30

# Check backend service
echo "🔍 Checking backend service..."
BACKEND_STATUS=$(ssh -i ~/.ssh/pve_ai_key root@$PROXMOX_IP "pct exec $CONTAINER_ID -- systemctl is-active bitbonsai-backend" || echo "failed")
if [ "$BACKEND_STATUS" = "active" ]; then
  echo "   ✅ Backend service: Running"
else
  echo "   ❌ Backend service: $BACKEND_STATUS"
fi

# Check frontend service
echo "🔍 Checking frontend service..."
FRONTEND_STATUS=$(ssh -i ~/.ssh/pve_ai_key root@$PROXMOX_IP "pct exec $CONTAINER_ID -- systemctl is-active bitbonsai-frontend" || echo "failed")
if [ "$FRONTEND_STATUS" = "active" ]; then
  echo "   ✅ Frontend service: Running"
else
  echo "   ❌ Frontend service: $FRONTEND_STATUS"
fi

# Test backend API health endpoint
echo "🔍 Testing backend API health..."
BACKEND_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://$CONTAINER_IP:3100/api/v1/health" 2>/dev/null || echo "000")
if [ "$BACKEND_HEALTH" = "200" ]; then
  echo "   ✅ Backend API: HTTP $BACKEND_HEALTH (Healthy)"
else
  echo "   ❌ Backend API: HTTP $BACKEND_HEALTH (Unhealthy)"
fi

# Test frontend accessibility
echo "🔍 Testing frontend accessibility..."
FRONTEND_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://$CONTAINER_IP:3000/" 2>/dev/null || echo "000")
if [ "$FRONTEND_HEALTH" = "200" ]; then
  echo "   ✅ Frontend: HTTP $FRONTEND_HEALTH (Accessible)"
else
  echo "   ❌ Frontend: HTTP $FRONTEND_HEALTH (Not accessible)"
fi

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo "Container ID: $CONTAINER_ID"
echo "Container IP: $CONTAINER_IP"
echo ""
echo "Access URLs:"
echo "  Frontend:  http://$CONTAINER_IP:3000"
echo "  Backend:   http://$CONTAINER_IP:3100/api/v1"
echo "  API Docs:  http://$CONTAINER_IP:3100/api/docs"
echo ""
echo "SSH Access:"
echo "  ssh root@$CONTAINER_IP"
echo "  Password: bitbonsai"
echo ""
echo "BitBonsai Web Credentials:"
echo "  Username: admin"
echo "  Password: admin"
echo ""
echo "To access from Proxmox host:"
echo "  ssh -i ~/.ssh/pve_ai_key root@$PROXMOX_IP"
echo "  pct enter $CONTAINER_ID"
echo "=========================================="
