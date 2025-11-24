#!/usr/bin/env bash

# BitBonsai LXC Installation Script for Proxmox VE Community Scripts
# Compatible with: https://community-scripts.github.io/ProxmoxVE/
# Repository: https://github.com/community-scripts/ProxmoxVE

source <(curl -s https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/misc/build.func)

# Application metadata
APP="BitBonsai"
var_tags="media;video;encoding;ffmpeg"
var_cpu="4"
var_ram="4096"
var_disk="20"
var_os="ubuntu"
var_version="24.04"
var_unprivileged="1"

# Application variables
var_install_type="0"
BITBONSAI_VERSION="latest"

# Additional features needed for NFS support
FEATURES="nesting=1,fuse=1,mount=nfs"

# Color codes for output
COLOR_N='\033[0m'
COLOR_Y='\033[1;33m'

# Header
function header_info {
cat <<"EOF"
    ____  _ __  ____
   / __ )(_) /_/ __ )____  ____  ________  _(_)
  / __  / / __/ __  / __ \/ __ \/ ___/ __ `/ /
 / /_/ / / /_/ /_/ / /_/ / / / (__  ) /_/ / /
/_____/_/\__/_____/\____/_/ /_/____/\__,_/_/

   Intelligent Video Encoding Platform
   Version: ${BITBONSAI_VERSION}
EOF
}

# Default container settings
function default_settings() {
  CT_TYPE="1"  # Unprivileged container
  PW=""
  CT_ID=$NEXTID
  HN=$NSAPP
  DISK_SIZE="$var_disk"
  CORE_COUNT="$var_cpu"
  RAM_SIZE="$var_ram"
  BRG="vmbr0"
  NET="dhcp"
  GATE=""
  APT_CACHER=""
  APT_CACHER_IP=""
  DISABLEIP6="no"
  MTU=""
  SD=""
  NS=""
  MAC=""
  VLAN=""
  SSH="no"
  VERB="no"
  echo_default
}

# Main installation function
function start_script() {
  if command -v pveversion >/dev/null 2>&1; then
    if [ $(pveversion | grep "pve-manager/8" | wc -l) -ne 1 ]; then
      msg_error "This version of Proxmox Virtual Environment is not supported"
      msg_error "Requires Proxmox VE 8.0 or higher"
      exit 1
    fi
  fi
}

# Update script for existing installations
function update_script() {
header_info
msg_info "Stopping BitBonsai services"
systemctl stop bitbonsai-backend
msg_ok "Services stopped"

msg_info "Pulling latest Docker image"
docker pull lucidfabrics/bitbonsai:${BITBONSAI_VERSION}
msg_ok "Image updated"

msg_info "Starting BitBonsai services"
systemctl start bitbonsai-backend
msg_ok "Services started"

msg_info "Cleaning up"
docker image prune -f
msg_ok "Cleanup complete"

msg_ok "Update completed successfully"
exit 0
}

# Installation steps
start
build_container
description

# System packages installation
msg_info "Installing system dependencies"
$STD apt-get update
$STD apt-get upgrade -y
$STD apt-get install -y \
  curl \
  wget \
  git \
  build-essential \
  sqlite3 \
  ca-certificates \
  gnupg \
  lsb-release \
  openssh-server \
  nfs-common \
  software-properties-common
msg_ok "System dependencies installed"

# Node.js installation
msg_info "Installing Node.js 20.x LTS"
$STD bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
$STD apt-get install -y nodejs
msg_ok "Node.js $(node --version) installed"

# FFmpeg installation
msg_info "Installing FFmpeg 7.x"
$STD add-apt-repository -y ppa:ubuntuhandbook1/ffmpeg7
$STD apt-get update
$STD apt-get install -y ffmpeg ffprobe
FFMPEG_VERSION=$(ffmpeg -version | head -n1 | awk '{print $3}')
msg_ok "FFmpeg $FFMPEG_VERSION installed"

# Prisma CLI installation
msg_info "Installing Prisma CLI"
$STD npm install -g prisma@latest
msg_ok "Prisma CLI installed"

# Create application directory
msg_info "Creating application directories"
mkdir -p /opt/bitbonsai
mkdir -p /opt/bitbonsai/data
mkdir -p /opt/bitbonsai/logs
msg_ok "Directories created"

# Clone repository and build
msg_info "Downloading BitBonsai source"
cd /opt/bitbonsai
$STD git clone https://github.com/wassimmehanna/bitbonsai.git .
msg_ok "Source downloaded"

# Install dependencies
msg_info "Installing Node.js dependencies"
$STD npm ci --legacy-peer-deps
msg_ok "Dependencies installed"

# Generate Prisma client
msg_info "Generating Prisma client"
$STD npx prisma generate
msg_ok "Prisma client generated"

# Build application
msg_info "Building BitBonsai (this may take a few minutes)"
$STD npx nx build backend --configuration=production
$STD npx nx build frontend --configuration=production
msg_ok "Build completed"

# Run database migrations
msg_info "Running database migrations"
export DATABASE_URL="file:/opt/bitbonsai/data/bitbonsai.db"
$STD npx prisma migrate deploy
msg_ok "Database initialized"

# Generate secrets
msg_info "Generating security secrets"
JWT_SECRET=$(openssl rand -base64 32)
ADMIN_PASSWORD=$(openssl rand -base64 24)

# Create environment file
cat > /opt/bitbonsai/.env <<EOF
# BitBonsai Configuration
NODE_ENV=production
PORT=8108
DATABASE_URL=file:/opt/bitbonsai/data/bitbonsai.db
JWT_SECRET=${JWT_SECRET}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
LOG_LEVEL=info
EOF
msg_ok "Environment configured"

# Create systemd service
msg_info "Creating systemd service"
cat > /etc/systemd/system/bitbonsai.service <<EOF
[Unit]
Description=BitBonsai - Intelligent Video Encoding Platform
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/bitbonsai
EnvironmentFile=/opt/bitbonsai/.env
ExecStart=/usr/bin/node /opt/bitbonsai/dist/apps/backend/main.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bitbonsai

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable bitbonsai
systemctl start bitbonsai
msg_ok "Service configured and started"

# Get container IP
CONTAINER_IP=$(hostname -I | awk '{print $1}')

# Cleanup
msg_info "Cleaning up"
$STD apt-get autoremove -y
$STD apt-get autoclean -y
msg_ok "Cleanup complete"

# Success message
msg_ok "BitBonsai installation completed!"
echo -e "\n${COLOR_Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_N}"
echo -e "${COLOR_Y}  BitBonsai is now running!${COLOR_N}"
echo -e "${COLOR_Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_N}"
echo -e "\n  Access BitBonsai Web UI:"
echo -e "  ${COLOR_Y}http://${CONTAINER_IP}:8108${COLOR_N}\n"
echo -e "  Default Credentials:"
echo -e "  Username: ${COLOR_Y}admin${COLOR_N}"
echo -e "  Password: ${COLOR_Y}${ADMIN_PASSWORD}${COLOR_N}\n"
echo -e "  ${COLOR_Y}IMPORTANT:${COLOR_N} Save these credentials!\n"
echo -e "  Service Management:"
echo -e "  Status:  ${COLOR_Y}systemctl status bitbonsai${COLOR_N}"
echo -e "  Logs:    ${COLOR_Y}journalctl -u bitbonsai -f${COLOR_N}"
echo -e "  Restart: ${COLOR_Y}systemctl restart bitbonsai${COLOR_N}\n"
echo -e "${COLOR_Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_N}\n"
