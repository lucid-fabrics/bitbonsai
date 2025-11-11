# BitBonsai LXC Container Deployment

Deploy BitBonsai as an LXC container on any Proxmox server.

## Quick Start

```bash
cd deploy-lxc
chmod +x *.sh scripts/*.sh
./deploy-to-proxmox.sh [proxmox-host] [proxmox-ip] [container-id] [environment]
```

**Examples:**
```bash
# Development environment (16 cores, 32GB RAM, 500GB storage)
./deploy-to-proxmox.sh pve-mirna 192.168.1.2 200 dev

# Production environment (4 cores, 4GB RAM, 20GB storage)
./deploy-to-proxmox.sh pve-mirna 192.168.1.2 200 prod

# Default is 'dev' if not specified
./deploy-to-proxmox.sh pve-mirna 192.168.1.2 200
```

## What Gets Installed

- **OS:** Ubuntu 24.04 LTS (amd64)
- **Runtime:** Node.js 20.x
- **Encoder:** FFmpeg 7.x
- **Web Server:** Nginx
- **Database:** SQLite (Prisma)

## Container Specifications

### Development Environment (default)
- **CPU:** 16 cores
- **RAM:** 32GB
- **Swap:** 8GB
- **Storage:** 500GB
- **Network:** Bridged (DHCP)

**Use case:** Heavy encoding workload, multiple concurrent jobs, testing

### Production Environment
- **CPU:** 4 cores
- **RAM:** 4GB
- **Swap:** 2GB
- **Storage:** 20GB
- **Network:** Bridged (DHCP)

**Use case:** Lightweight deployment, single-node encoding

> **Note:** Specs are defined in `lxc-specs.conf` and can be customized per deployment

## Post-Deployment

After deployment completes, you'll see:
- Container IP address
- Frontend URL
- API URL
- SSH credentials: root / bitbonsai

## Managing the Container

**Direct SSH access to container:**
```bash
ssh root@<container-ip>
# Password: bitbonsai
```

**Access via Proxmox:**
```bash
ssh -i ~/.ssh/pve_ai_key root@proxmox-ip
pct enter 200
```

**View logs:**
```bash
pct enter 200
journalctl -u bitbonsai-backend -f
```

**Restart services:**
```bash
pct enter 200
systemctl restart bitbonsai-backend
systemctl restart nginx
```

## Troubleshooting

**Container won't start:**
```bash
pct status 200
pct start 200
```

**Check backend status:**
```bash
pct enter 200
systemctl status bitbonsai-backend
```

**Check nginx status:**
```bash
pct enter 200
systemctl status nginx
nginx -t
```

## Configuration

### Environment Variables
Environment variables are stored in `/opt/bitbonsai/.env` inside the container.

Default settings:
- PORT: 3000
- DATABASE_URL: file:/opt/bitbonsai/data/bitbonsai.db
- JWT_SECRET: Auto-generated on install

### Custom Container Specs
To customize CPU, RAM, and storage specs, edit `lxc-specs.conf`:

```bash
# Development Environment
DEV_CORES=16       # CPU cores
DEV_MEMORY=32768   # RAM in MB
DEV_SWAP=8192      # Swap in MB
DEV_STORAGE=500    # Storage in GB

# Production Environment
PROD_CORES=4
PROD_MEMORY=4096
PROD_SWAP=2048
PROD_STORAGE=20
```

Changes take effect on next deployment.

## Directory Structure

```
/opt/bitbonsai/
├── apps/              # Application code
├── libs/              # Shared libraries
├── prisma/            # Database schema
├── dist/              # Built application
├── data/              # SQLite database
├── node_modules/      # Dependencies
└── .env               # Configuration
```

## Requirements

- Proxmox VE 7.x or 8.x
- SSH access to Proxmox host
- SSH key at ~/.ssh/pve_ai_key
- **DEV:** At least 500GB free storage, 16 cores, 32GB RAM
- **PROD:** At least 20GB free storage, 4 cores, 4GB RAM
- Network bridge configured (vmbr0)

## Version

BitBonsai v1.0.0
