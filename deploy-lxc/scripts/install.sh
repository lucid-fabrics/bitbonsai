#!/bin/bash
set -e

echo "=========================================="
echo "BitBonsai LXC Container Setup"
echo "Version: 1.0.0"
echo "=========================================="
echo ""

# Update system
echo "[1/8] Updating system packages..."
apt-get update
apt-get upgrade -y

# Set root password
echo "[2/8] Setting root password..."
echo "root:bitbonsai" | chpasswd

# Install essential packages
echo "[3/8] Installing essential packages..."
apt-get install -y \
  curl \
  wget \
  git \
  build-essential \
  python3 \
  sqlite3 \
  ca-certificates \
  gnupg \
  lsb-release \
  openssh-server

# Configure SSH
echo "[4/8] Configuring SSH server..."
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
systemctl enable ssh
systemctl start ssh

# Install Node.js 20.x
echo "[5/8] Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install FFmpeg 7.x
echo "[6/8] Installing FFmpeg 7.x..."
apt-get install -y software-properties-common
add-apt-repository -y ppa:ubuntuhandbook1/ffmpeg7
apt-get update
apt-get install -y ffmpeg

# Verify installations
echo "[7/8] Verifying installations..."
echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"
echo "  FFmpeg: $(ffmpeg -version | head -n1)"

# Install global npm packages
echo "[8/8] Installing global npm packages..."
npm install -g nx@latest prisma@latest

# Create bitbonsai user
echo "[9/8] Creating bitbonsai user..."
if ! id -u bitbonsai > /dev/null 2>&1; then
  useradd -m -s /bin/bash bitbonsai
  echo "bitbonsai:bitbonsai" | chpasswd
fi

# Create application directory
echo "[10/8] Setting up application directory..."
mkdir -p /opt/bitbonsai
chown -R bitbonsai:bitbonsai /opt/bitbonsai

echo ""
echo "=========================================="
echo "System setup complete!"
echo "=========================================="
