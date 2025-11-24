# Proxmox VE Community Scripts Deployment Guide

This guide explains how to deploy BitBonsai to Proxmox VE Community Scripts repository for one-click LXC installation.

## Architecture

**LXC Container** (Port 8108):
```
Container (Ubuntu 24.04 LTS)
├── Node.js 20.x LTS
├── FFmpeg 7.x
├── BitBonsai Backend (port 8108)
├── SQLite database
└── NFS client (for multi-node)
```

## Community Scripts Repository

BitBonsai can be submitted to the official [Proxmox VE Community Scripts](https://community-scripts.github.io/ProxmoxVE/) repository, allowing users to install with a single command.

### Features

**✅ One-Click Installation**
- Automated LXC container creation
- System dependencies (Node.js, FFmpeg, Prisma)
- Application build and deployment
- Systemd service configuration
- NFS support for multi-node setups

**✅ Resource Defaults**
- CPU: 4 cores
- RAM: 4096 MB
- Storage: 20 GB
- Network: DHCP (configurable to static)

**✅ Security**
- Unprivileged container
- Auto-generated JWT secret
- Auto-generated admin password
- SSH enabled (optional)

---

## Building the Release

### 1. Generate Community Scripts Package

```bash
# Generate Proxmox release package (uses version from package.json)
npx nx proxmox:release

# Bump patch version and generate release (1.0.0 → 1.0.1)
npx nx release:proxmox

# Bump minor version and generate release (1.0.0 → 1.1.0)
npx nx release:proxmox:minor

# Bump major version and generate release (1.0.0 → 2.0.0)
npx nx release:proxmox:major
```

### 2. Test Locally

Before submitting to the community repository, test the installation script:

```bash
# On your Proxmox host
cd /tmp
wget https://raw.githubusercontent.com/wassimmehanna/bitbonsai/main/proxmox-release/bitbonsai-install.sh
bash bitbonsai-install.sh
```

**Expected behavior:**
- Creates LXC container
- Installs all dependencies
- Builds and deploys BitBonsai
- Starts systemd service
- Displays access credentials

### 3. Verify Installation

```bash
# Check container status
pct status <CONTAINER_ID>

# Check service status
pct exec <CONTAINER_ID> -- systemctl status bitbonsai

# View logs
pct exec <CONTAINER_ID> -- journalctl -u bitbonsai -f

# Test web UI
curl http://<CONTAINER_IP>:8108/api/v1/health
```

---

## Submitting to Community Scripts

### 1. Fork the Repository

```bash
git clone https://github.com/community-scripts/ProxmoxVE.git
cd ProxmoxVE
```

### 2. Add Your Script

Copy `proxmox-release/bitbonsai-install.sh` to the repository:

```bash
# Copy installation script
cp /path/to/bitbonsai/proxmox-release/bitbonsai-install.sh \
   install/bitbonsai-install.sh

# Add metadata to JSON catalog
# Edit: json/applications.json
```

**Application metadata (applications.json):**
```json
{
  "name": "BitBonsai",
  "slug": "bitbonsai",
  "categories": ["Media", "Video", "Tools"],
  "date_created": "2025-01-23",
  "type": "ct",
  "updateable": true,
  "privileged": false,
  "interface_port": "8108",
  "website": "https://github.com/wassimmehanna/bitbonsai",
  "documentation": "https://github.com/wassimmehanna/bitbonsai/blob/main/README.md",
  "logo": "https://raw.githubusercontent.com/wassimmehanna/bitbonsai/main/apps/frontend/src/assets/logo.png",
  "description": "Intelligent video encoding platform with multi-node distribution, hardware acceleration, and zero-plugin architecture. Automatically converts H.264 to H.265/AV1 for 40-70% storage savings.",
  "install_methods": [{
    "type": "default",
    "script": "bash -c \"$(wget -qLO - https://github.com/community-scripts/ProxmoxVE/raw/main/ct/bitbonsai.sh)\""
  }]
}
```

### 3. Create Pull Request

```bash
# Create branch
git checkout -b add-bitbonsai

# Commit changes
git add install/bitbonsai-install.sh json/applications.json
git commit -m "Add BitBonsai - Intelligent Video Encoding Platform"

# Push to your fork
git push origin add-bitbonsai
```

**Submit PR to:** https://github.com/community-scripts/ProxmoxVE

**Include in PR:**
- ✅ Clear description of BitBonsai
- ✅ Link to GitHub repository
- ✅ Screenshots of web UI
- ✅ List of tested Proxmox VE versions (8.0+)
- ✅ Hardware requirements and recommendations
- ✅ Confirmation that script follows community guidelines

---

## Installation Methods

### Method 1: Proxmox VE Helper Scripts (Official)

Once approved in community repository:

```bash
# Run from Proxmox VE shell
bash -c "$(wget -qLO - https://github.com/community-scripts/ProxmoxVE/raw/main/ct/bitbonsai.sh)"
```

### Method 2: Direct Script Execution

For development/testing:

```bash
# Download and execute
wget https://raw.githubusercontent.com/wassimmehanna/bitbonsai/main/proxmox-release/bitbonsai-install.sh
bash bitbonsai-install.sh
```

### Method 3: Manual LXC Deployment (Advanced)

Using existing `deploy-lxc` infrastructure:

```bash
cd deploy-lxc
./deploy-to-proxmox.sh <proxmox_host> <proxmox_ip> <container_id> prod
```

---

## Default Configuration

### Container Specifications

| Resource | Default | Minimum | Recommended |
|----------|---------|---------|-------------|
| **CPU Cores** | 4 | 2 | 6+ |
| **RAM** | 4096 MB | 2048 MB | 8192 MB+ |
| **Storage** | 20 GB | 10 GB | 50 GB+ |
| **Network** | DHCP | - | Static IP |

### Application Defaults

| Setting | Value |
|---------|-------|
| **Port** | 8108 |
| **Database** | SQLite (/opt/bitbonsai/data/bitbonsai.db) |
| **Logs** | journalctl -u bitbonsai |
| **Service** | systemd |
| **User** | root (in container) |

### Security Defaults

| Setting | Value |
|---------|-------|
| **JWT Secret** | Auto-generated (32 bytes) |
| **Admin Password** | Auto-generated (24 bytes) |
| **Container Type** | Unprivileged |
| **SSH Access** | Optional (disabled by default) |

---

## Post-Installation

### 1. Access Web UI

```
http://<CONTAINER_IP>:8108
```

### 2. Login Credentials

**Default credentials are displayed after installation:**
- Username: `admin`
- Password: `<auto-generated>`

**Retrieve forgotten password:**
```bash
pct exec <CONTAINER_ID> -- cat /opt/bitbonsai/.env | grep ADMIN_PASSWORD
```

### 3. Configure Media Libraries

1. Navigate to **Settings → Libraries**
2. Add media paths (must be mounted in container)
3. Configure encoding policies
4. Start first scan

### 4. Multi-Node Setup (Optional)

For distributed encoding across multiple Proxmox nodes:

1. **Install BitBonsai on additional containers**
2. **Configure storage sharing:**
   - Option A: NFS auto-mount (automatic)
   - Option B: Proxmox bind mounts (manual)
3. **Pair nodes via web UI:**
   - MAIN node: Navigate to **Nodes → Register**
   - LINKED node: Enter MAIN node URL
   - MAIN node: Approve registration request

**See [MULTI-NODE-SETUP.md](./deploy-lxc/MULTI-NODE-SETUP.md) for detailed guide.**

---

## Updating BitBonsai

### Via Update Script

```bash
# Run update script inside container
pct exec <CONTAINER_ID> -- bash <(curl -s https://raw.githubusercontent.com/wassimmehanna/bitbonsai/main/proxmox-release/bitbonsai-install.sh) -s update
```

### Manual Update

```bash
# Enter container
pct enter <CONTAINER_ID>

# Pull latest code
cd /opt/bitbonsai
git pull

# Rebuild
npm ci --legacy-peer-deps
npx nx build backend --configuration=production
npx nx build frontend --configuration=production

# Restart service
systemctl restart bitbonsai
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check container status
pct status <CONTAINER_ID>

# View startup logs
journalctl -xeu pve-container@<CONTAINER_ID>.service

# Check for resource conflicts
pct config <CONTAINER_ID>
```

### Service Won't Start

```bash
# Check service status
pct exec <CONTAINER_ID> -- systemctl status bitbonsai

# View service logs
pct exec <CONTAINER_ID> -- journalctl -u bitbonsai -n 100

# Check for missing dependencies
pct exec <CONTAINER_ID> -- node --version
pct exec <CONTAINER_ID> -- ffmpeg -version
```

### Web UI Not Accessible

```bash
# Check if port 8108 is listening
pct exec <CONTAINER_ID> -- netstat -tlnp | grep 8108

# Check firewall
pct exec <CONTAINER_ID> -- iptables -L

# Verify container network
pct exec <CONTAINER_ID> -- ip addr show
```

### Database Issues

```bash
# Check database file
pct exec <CONTAINER_ID> -- ls -lh /opt/bitbonsai/data/bitbonsai.db

# Reset database (WARNING: Deletes all data)
pct exec <CONTAINER_ID> -- rm /opt/bitbonsai/data/bitbonsai.db
pct exec <CONTAINER_ID> -- npx prisma migrate deploy
pct exec <CONTAINER_ID> -- systemctl restart bitbonsai
```

### NFS Mount Issues (Multi-Node)

```bash
# Check NFS client
pct exec <CONTAINER_ID> -- systemctl status rpc-statd

# Test NFS mount
pct exec <CONTAINER_ID> -- showmount -e <MAIN_NODE_IP>

# Manual mount
pct exec <CONTAINER_ID> -- mount -t nfs <MAIN_NODE_IP>:/export/media /media
```

---

## Resource Optimization

### CPU Priority

Encoding can be CPU-intensive. Adjust priority if needed:

```bash
# Lower priority (nice +10)
systemctl edit bitbonsai

# Add these lines under [Service]:
Nice=10
```

### Memory Limits

For high-concurrency setups:

```bash
# Increase container RAM
pct set <CONTAINER_ID> -memory 8192

# Increase Node.js heap
systemctl edit bitbonsai

# Add under [Service]:
Environment="NODE_OPTIONS=--max-old-space-size=4096"
```

### Storage Considerations

**Temp Files:**
- BitBonsai uses `/tmp` for encoding temp files
- Consider mounting SSD storage for `/tmp` (10-100x faster)

**Database:**
- SQLite is sufficient for single-node setups
- For 10+ nodes, consider PostgreSQL (see README.md)

---

## Backup & Restore

### Backup Container

```bash
# Create backup
vzdump <CONTAINER_ID> --compress zstd --mode snapshot --storage local

# Backup stored in:
/var/lib/vz/dump/vzdump-lxc-<CONTAINER_ID>-<DATE>.tar.zst
```

### Restore Container

```bash
# Restore from backup
pct restore <NEW_CONTAINER_ID> /var/lib/vz/dump/vzdump-lxc-<CONTAINER_ID>-<DATE>.tar.zst \
  --storage local-lvm
```

### Backup Database Only

```bash
# Copy database file
pct exec <CONTAINER_ID> -- cp /opt/bitbonsai/data/bitbonsai.db /tmp/backup.db
pct pull <CONTAINER_ID> /tmp/backup.db ./bitbonsai-backup-$(date +%Y%m%d).db
```

---

## Community Resources

- **Official Repository:** https://github.com/wassimmehanna/bitbonsai
- **Proxmox VE Scripts:** https://community-scripts.github.io/ProxmoxVE/
- **Issue Tracker:** https://github.com/wassimmehanna/bitbonsai/issues
- **Multi-Node Guide:** [MULTI-NODE-SETUP.md](./deploy-lxc/MULTI-NODE-SETUP.md)

---

## License

BitBonsai uses a dual-license model:
- **Free Tier:** MIT License (single node, 5 concurrent jobs)
- **Commercial:** Paid licenses for multi-node, unlimited jobs, and commercial use

See [README.md](./README.md) for pricing details.
