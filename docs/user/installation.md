# BitBonsai Installation Guide

> **Complete installation instructions for Docker, Unraid, Proxmox LXC, and bare metal**

This guide covers all installation methods for BitBonsai. Choose the method that best suits your infrastructure.

---

## Table of Contents

- [System Requirements](#system-requirements)
- [Docker Installation](#docker-installation)
- [Docker Compose Installation](#docker-compose-installation)
- [Unraid Installation](#unraid-installation)
- [Proxmox LXC Installation](#proxmox-lxc-installation)
- [Bare Metal Installation](#bare-metal-installation)
- [Post-Installation](#post-installation)
- [Upgrading](#upgrading)
- [Uninstallation](#uninstallation)

---

## System Requirements

### Minimum Requirements

| Component | Requirement |
|-----------|-------------|
| **OS** | Linux (Ubuntu 20.04+, Debian 11+, Unraid 6.9+) |
| **CPU** | 2 cores (4+ recommended for concurrent encoding) |
| **RAM** | 4GB (8GB+ recommended) |
| **Storage** | 10GB for application + 20% of media library size for temp files |
| **Docker** | 20.10+ (if using Docker) |
| **Node.js** | 20.x LTS (bare metal only) |

### Recommended Hardware

For optimal performance:

| Hardware | Benefit | Example |
|----------|---------|---------|
| **GPU** | 5-10x faster encoding | NVIDIA GTX 1650+, Intel i5-8xxx+ (QuickSync), AMD RX 5000+ |
| **SSD** | 10-100x faster temp I/O | NVMe or SATA SSD for `/cache` volume |
| **Multi-core CPU** | Parallel processing | Intel i7/i9, AMD Ryzen 7/9 |
| **Fast Network** | Multi-node efficiency | 1Gbps+ Ethernet |

### Supported Platforms

| Platform | Support Level | Notes |
|----------|--------------|-------|
| **Docker** | ✅ Official | Recommended deployment method |
| **Unraid** | ✅ Official | Community Apps template available |
| **Proxmox LXC** | ✅ Official | Automated deployment script provided |
| **Kubernetes** | ⚠️ Community | Helm charts community-maintained |
| **Bare Metal** | ⚠️ Advanced | For developers only |
| **Windows** | ❌ Not supported | Use WSL2 + Docker |
| **macOS** | ⚠️ Development only | Docker Desktop for testing |

---

## Docker Installation

The simplest way to run BitBonsai.

### Quick Start

```bash
docker run -d \
  --name=bitbonsai \
  --restart=unless-stopped \
  -p 4210:4210 \
  -p 3100:3100 \
  -e TZ=America/New_York \
  -e NODE_ENV=production \
  -v /path/to/media:/media:ro \
  -v bitbonsai-data:/data \
  lucidfabrics/bitbonsai:latest
```

**Access**: `http://localhost:4210`

### Detailed Configuration

#### With GPU Acceleration (NVIDIA)

```bash
docker run -d \
  --name=bitbonsai \
  --restart=unless-stopped \
  --runtime=nvidia \
  --gpus all \
  -p 4210:4210 \
  -p 3100:3100 \
  -e TZ=America/New_York \
  -e NODE_ENV=production \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility \
  -v /path/to/media:/media:ro \
  -v bitbonsai-data:/data \
  lucidfabrics/bitbonsai:latest
```

**Prerequisites:**
- NVIDIA Docker runtime installed
- NVIDIA drivers installed on host

**Install NVIDIA Docker runtime:**
```bash
# Add NVIDIA Docker repository
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list

# Install nvidia-docker2
sudo apt-get update
sudo apt-get install -y nvidia-docker2

# Restart Docker
sudo systemctl restart docker
```

#### With GPU Acceleration (Intel QuickSync)

```bash
docker run -d \
  --name=bitbonsai \
  --restart=unless-stopped \
  --device=/dev/dri:/dev/dri \
  -p 4210:4210 \
  -p 3100:3100 \
  -e TZ=America/New_York \
  -e NODE_ENV=production \
  -v /path/to/media:/media:ro \
  -v bitbonsai-data:/data \
  lucidfabrics/bitbonsai:latest
```

**Prerequisites:**
- Intel CPU with QuickSync (8th gen+)
- i965-va-driver or intel-media-driver installed

#### With GPU Acceleration (AMD)

```bash
docker run -d \
  --name=bitbonsai \
  --restart=unless-stopped \
  --device=/dev/dri/renderD128:/dev/dri/renderD128 \
  -p 4210:4210 \
  -p 3100:3100 \
  -e TZ=America/New_York \
  -e NODE_ENV=production \
  -v /path/to/media:/media:ro \
  -v bitbonsai-data:/data \
  lucidfabrics/bitbonsai:latest
```

#### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `TZ` | Timezone (e.g., America/New_York) | UTC | No |
| `NODE_ENV` | Environment (production/development) | production | Yes |
| `PORT` | Frontend port | 4210 | No |
| `API_PORT` | Backend API port | 3100 | No |
| `DATABASE_URL` | Database connection string | file:/data/bitbonsai.db | No |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) | info | No |
| `ENCODING_TEMP_PATH` | Temp file location for encoding | /tmp | No |
| `MAX_CONCURRENT_JOBS` | Max parallel encoding jobs | 2 | No |

---

## Docker Compose Installation

For more complex deployments with multiple services.

### Basic Setup

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  bitbonsai:
    image: lucidfabrics/bitbonsai:latest
    container_name: bitbonsai
    restart: unless-stopped
    ports:
      - "4210:4210"  # Frontend
      - "3100:3100"  # API
    environment:
      - TZ=America/New_York
      - NODE_ENV=production
    volumes:
      - /mnt/user/media:/media:ro              # Media library (read-only)
      - bitbonsai-data:/data                   # Application data
    # Optional: GPU passthrough
    # devices:
    #   - /dev/dri:/dev/dri  # Intel QuickSync
    # runtime: nvidia         # NVIDIA
    # environment:
    #   - NVIDIA_VISIBLE_DEVICES=all

volumes:
  bitbonsai-data:
```

**Start services:**
```bash
docker-compose up -d
```

### Production Setup with PostgreSQL

For commercial tier and high-performance setups:

```yaml
version: '3.8'

services:
  bitbonsai:
    image: lucidfabrics/bitbonsai:latest
    container_name: bitbonsai
    restart: unless-stopped
    depends_on:
      - postgres
      - redis
    ports:
      - "4210:4210"
      - "3100:3100"
    environment:
      - TZ=America/New_York
      - NODE_ENV=production
      - DATABASE_URL=postgresql://bitbonsai:${POSTGRES_PASSWORD}@postgres:5432/bitbonsai
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - LICENSE_KEY=${LICENSE_KEY}  # Commercial license
    volumes:
      - /mnt/user/media:/media:ro
      - bitbonsai-data:/data
    networks:
      - bitbonsai-network

  postgres:
    image: postgres:16-alpine
    container_name: bitbonsai-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=bitbonsai
      - POSTGRES_USER=bitbonsai
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - bitbonsai-network

  redis:
    image: redis:7-alpine
    container_name: bitbonsai-redis
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    networks:
      - bitbonsai-network

volumes:
  bitbonsai-data:
  postgres-data:
  redis-data:

networks:
  bitbonsai-network:
    driver: bridge
```

**Create `.env` file:**
```bash
POSTGRES_PASSWORD=your_secure_password_here
LICENSE_KEY=your_commercial_license_key
```

**Start stack:**
```bash
docker-compose --env-file .env up -d
```

---

## Unraid Installation

### Via Community Applications (Recommended)

1. **Install Community Applications Plugin** (if not already installed)
   - Apps → Plugins → Install Community Applications

2. **Search for BitBonsai**
   - Apps → Search "BitBonsai"
   - Click **Install**

3. **Configure Template**

   **Required Settings:**
   - **WebUI Port**: 4210 (or any available port)
   - **API Port**: 3100 (MUST remain 3100)
   - **Media Library**: `/mnt/user/media` (your media path)
   - **App Data**: `/mnt/user/appdata/bitbonsai`

   **CRITICAL - SSD Cache Pool:**
   - **Encoding Cache**: `/mnt/cache/bitbonsai-temp`
   - This provides 10-100x faster encoding I/O
   - See [Unraid Release Guide](../releases/unraid.md#cache-pool-configuration)

   **Optional - GPU:**
   - **NVIDIA**: Extra Parameters: `--runtime=nvidia --gpus all`
   - **Intel QSV**: Device: `/dev/dri` → `/dev/dri`
   - **AMD**: Device: `/dev/dri/renderD128` → `/dev/dri/renderD128`

4. **Apply & Start**
   - Click **Apply**
   - Wait for container to download and start

5. **Access WebUI**
   - Navigate to `http://YOUR_SERVER_IP:4210`
   - Or click WebUI button in Unraid Docker tab

### Manual Docker Run (Unraid)

If Community Apps unavailable:

```bash
docker run -d \
  --name='bitbonsai' \
  --net='host' \
  --restart=unless-stopped \
  -e TZ="America/New_York" \
  -e HOST_OS="Unraid" \
  -e ENCODING_TEMP_PATH='/cache' \
  -v '/mnt/user/media/':'/media':'ro' \
  -v '/mnt/user/appdata/bitbonsai/':'/data':'rw' \
  -v '/mnt/cache/bitbonsai-temp/':'/cache':'rw' \
  'lucidfabrics/bitbonsai:latest'
```

**Note**: Host networking (`--net='host'`) required for mDNS auto-discovery of child nodes.

### Unraid Updates

**Via Community Applications:**
1. Docker tab → Check for Updates
2. Click **Update** when available
3. Container restarts automatically

**Manual:**
```bash
docker pull lucidfabrics/bitbonsai:latest
docker stop bitbonsai
docker rm bitbonsai
# Re-run docker run command
```

---

## Proxmox LXC Installation

Automated deployment for Proxmox VE using LXC containers.

### Prerequisites

- Proxmox VE 7.0+
- SSH access to Proxmox host
- Available CTID (container ID)
- Internet connection for container download

### Automated Deployment

BitBonsai includes a comprehensive LXC deployment script:

```bash
# From your development machine (with BitBonsai repo)
cd ~/git/bitbonsai/deploy-lxc

# Deploy to Proxmox node
./deploy-to-proxmox.sh <proxmox-node> <proxmox-ip> <ctid> <env>

# Example: Deploy to pve-ai node, CTID 202, dev environment
./deploy-to-proxmox.sh pve-ai 192.168.1.5 202 dev
```

**What it does:**
1. Creates Ubuntu 24.04 LXC container
2. Configures networking and storage
3. Installs Node.js 20.x, FFmpeg 7.1, PostgreSQL
4. Syncs BitBonsai source code
5. Installs dependencies
6. Generates Prisma Client
7. Runs database migrations
8. Starts frontend and backend services

**Access**: `http://<lxc-ip>:4210`

### Manual LXC Setup

If you prefer manual setup:

1. **Create LXC Container**
   ```bash
   pct create 202 local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst \
     --hostname bitbonsai \
     --cores 4 \
     --memory 8192 \
     --swap 2048 \
     --net0 name=eth0,bridge=vmbr0,ip=dhcp \
     --storage local-lvm \
     --rootfs local-lvm:20
   ```

2. **Start and enter container**
   ```bash
   pct start 202
   pct enter 202
   ```

3. **Install dependencies**
   ```bash
   # Update system
   apt update && apt upgrade -y

   # Install Node.js 20.x
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
   apt install -y nodejs

   # Install FFmpeg 7.1 (static build)
   wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
   tar xf ffmpeg-release-amd64-static.tar.xz
   cp ffmpeg-7.1-amd64-static/ffmpeg /usr/local/bin/
   cp ffmpeg-7.1-amd64-static/ffprobe /usr/local/bin/

   # Install PostgreSQL 16
   apt install -y postgresql postgresql-contrib
   ```

4. **Deploy BitBonsai**
   ```bash
   # Clone repository
   git clone https://github.com/lucidfabrics/bitbonsai.git /opt/bitbonsai
   cd /opt/bitbonsai

   # Install dependencies
   npm install

   # Generate Prisma Client
   npx prisma generate

   # Run migrations
   npx prisma migrate deploy

   # Build applications
   npx nx build frontend --prod
   npx nx build backend --prod

   # Start services (use PM2 or systemd)
   npm install -g pm2
   pm2 start dist/apps/backend/main.js --name bitbonsai-backend
   pm2 startup
   pm2 save
   ```

---

## Bare Metal Installation

For advanced users and development.

### Prerequisites

- Ubuntu 24.04 LTS or Debian 12
- Node.js 20.x LTS
- FFmpeg 7.1+
- PostgreSQL 16 (optional, defaults to SQLite)

### Installation Steps

1. **Install System Dependencies**
   ```bash
   # Update system
   sudo apt update && sudo apt upgrade -y

   # Install build tools
   sudo apt install -y git curl wget build-essential

   # Install Node.js 20.x
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs

   # Install FFmpeg 7.1
   wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
   tar xf ffmpeg-release-amd64-static.tar.xz
   sudo cp ffmpeg-7.1-amd64-static/ffmpeg /usr/local/bin/
   sudo cp ffmpeg-7.1-amd64-static/ffprobe /usr/local/bin/
   sudo chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

   # Verify installations
   node --version   # Should show v20.x.x
   npm --version
   ffmpeg -version  # Should show 7.1+
   ```

2. **Clone Repository**
   ```bash
   git clone https://github.com/lucidfabrics/bitbonsai.git
   cd bitbonsai
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Configure Environment**
   ```bash
   # Copy environment template
   cp .env.example .env

   # Edit configuration
   nano .env
   ```

   **`.env` contents:**
   ```bash
   NODE_ENV=production
   PORT=4210
   API_PORT=3100
   DATABASE_URL="file:/opt/bitbonsai/data/bitbonsai.db"
   MEDIA_PATHS="/mnt/media"
   LOG_LEVEL=info
   ```

5. **Setup Database**
   ```bash
   # Generate Prisma Client
   npx prisma generate

   # Run migrations
   npx prisma migrate deploy

   # Optional: Seed test data
   npx prisma db seed
   ```

6. **Build Applications**
   ```bash
   # Build frontend
   npx nx build frontend --prod

   # Build backend
   npx nx build backend --prod
   ```

7. **Start Services**

   **Option 1: PM2 (Recommended)**
   ```bash
   # Install PM2
   sudo npm install -g pm2

   # Start backend
   pm2 start dist/apps/backend/main.js --name bitbonsai-backend

   # Start frontend (serve static files with nginx or similar)
   # Or serve with http-server:
   sudo npm install -g http-server
   pm2 start http-server --name bitbonsai-frontend -- dist/apps/frontend -p 4210

   # Save PM2 configuration
   pm2 startup
   pm2 save
   ```

   **Option 2: systemd**

   Create `/etc/systemd/system/bitbonsai-backend.service`:
   ```ini
   [Unit]
   Description=BitBonsai Backend
   After=network.target

   [Service]
   Type=simple
   User=bitbonsai
   WorkingDirectory=/opt/bitbonsai
   ExecStart=/usr/bin/node dist/apps/backend/main.js
   Restart=always
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```

   Enable and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable bitbonsai-backend
   sudo systemctl start bitbonsai-backend
   ```

8. **Access Application**
   - Frontend: `http://localhost:4210`
   - API: `http://localhost:3100`

---

## Post-Installation

### 1. Verify Installation

**Check service status:**
```bash
# Docker
docker ps | grep bitbonsai

# Bare metal (PM2)
pm2 status

# Bare metal (systemd)
sudo systemctl status bitbonsai-backend
```

**Check logs:**
```bash
# Docker
docker logs bitbonsai

# PM2
pm2 logs bitbonsai-backend

# systemd
sudo journalctl -u bitbonsai-backend -f
```

### 2. Configure Firewall

**UFW (Ubuntu/Debian):**
```bash
sudo ufw allow 4210/tcp  # Frontend
sudo ufw allow 3100/tcp  # API
sudo ufw allow 5353/udp  # mDNS (for node discovery)
```

**Firewalld (RHEL/CentOS):**
```bash
sudo firewall-cmd --permanent --add-port=4210/tcp
sudo firewall-cmd --permanent --add-port=3100/tcp
sudo firewall-cmd --permanent --add-port=5353/udp
sudo firewall-cmd --reload
```

### 3. Initial Configuration

Navigate to `http://YOUR_IP:4210` and complete setup:

1. **Change default password**
2. **Add media libraries**
3. **Create encoding policies**
4. **Test encoding with a small file**

See [Getting Started Guide](./getting-started.md) for detailed walkthrough.

---

## Upgrading

### Docker

```bash
# Pull latest image
docker pull lucidfabrics/bitbonsai:latest

# Stop and remove container
docker stop bitbonsai
docker rm bitbonsai

# Re-create container (use same command as installation)
docker run -d ... lucidfabrics/bitbonsai:latest
```

### Docker Compose

```bash
docker-compose pull
docker-compose up -d
```

### Unraid

1. Docker tab → Check for Updates
2. Click **Update**
3. Container automatically recreated

### Bare Metal

```bash
cd /opt/bitbonsai

# Pull latest code
git pull origin main

# Update dependencies
npm install

# Rebuild
npx nx build frontend --prod
npx nx build backend --prod

# Restart services
pm2 restart all
```

---

## Uninstallation

### Docker

```bash
# Stop and remove container
docker stop bitbonsai
docker rm bitbonsai

# Remove image
docker rmi lucidfabrics/bitbonsai:latest

# Remove volumes (WARNING: deletes all data)
docker volume rm bitbonsai-data
```

### Docker Compose

```bash
# Stop and remove containers, networks, volumes
docker-compose down -v
```

### Unraid

1. Docker tab → BitBonsai container
2. Click **Stop**
3. Click **Remove**
4. (Optional) Delete appdata: `/mnt/user/appdata/bitbonsai`
5. (Optional) Delete cache: `/mnt/cache/bitbonsai-temp`

### Bare Metal

```bash
# Stop services
pm2 delete all
pm2 unstartup

# Remove application
sudo rm -rf /opt/bitbonsai

# Remove data (optional)
sudo rm -rf /var/lib/bitbonsai
```

---

## Troubleshooting

See [Getting Started - Troubleshooting](./getting-started.md#troubleshooting) for common issues.

---

## Next Steps

- **[Getting Started Guide](./getting-started.md)** - Initial configuration walkthrough
- **[Docker Setup Guide](./docker-setup.md)** - Advanced Docker configuration
- **[Encoding Policies](./encoding-policies.md)** - Policy system explained

---

<div align="center">

**Installation complete! Start optimizing your media library.**

[Docs Home](../README.md) • [Getting Started](./getting-started.md) • [Policies](./encoding-policies.md)

</div>
