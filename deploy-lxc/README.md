# BitBonsai LXC Container Deployment

Deploy BitBonsai as an LXC container on any Proxmox server.

## Quick Start

```bash
cd deploy-lxc
chmod +x *.sh scripts/*.sh
./deploy-to-proxmox.sh [proxmox-host] [proxmox-ip] [container-id]
```

**Example:**
```bash
./deploy-to-proxmox.sh pve-mirna 192.168.1.2 200
```

## What Gets Installed

- **OS:** Ubuntu 24.04 LTS (amd64)
- **Runtime:** Node.js 20.x
- **Encoder:** FFmpeg 7.x
- **Web Server:** Nginx
- **Database:** SQLite (Prisma)

## Container Specifications

- **CPU:** 4 cores
- **RAM:** 4GB
- **Swap:** 2GB
- **Storage:** 32GB
- **Network:** Bridged (DHCP)

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

Environment variables are stored in `/opt/bitbonsai/.env` inside the container.

Default settings:
- PORT: 3000
- DATABASE_URL: file:/opt/bitbonsai/data/bitbonsai.db
- JWT_SECRET: Auto-generated on install

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
- At least 32GB free storage
- Network bridge configured (vmbr0)

## Version

BitBonsai v1.0.0
