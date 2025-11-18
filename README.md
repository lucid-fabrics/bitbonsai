# BitBonsai 🌳

> **Self-hosted media optimizer with zero plugins and beautiful UX**

<div align="center">

[![Docker Pulls](https://img.shields.io/docker/pulls/lucidfabrics/bitbonsai?style=flat-square)](https://hub.docker.com/r/lucidfabrics/bitbonsai)
[![Version](https://img.shields.io/github/v/release/lucidfabrics/bitbonsai?style=flat-square)](https://github.com/lucidfabrics/bitbonsai/releases)
[![License](https://img.shields.io/badge/license-Dual%20(MIT%2FCommercial)-blue?style=flat-square)](#license)

**Transform your chaotic media library into a perfectly pruned digital garden.**

[Quick Start](#quick-start) • [Features](#features) • [Pricing](#pricing-) • [Documentation](#documentation)

</div>

---

## What is BitBonsai?

BitBonsai is a **professional-grade media automation platform** that turns your scattered video collection into an organized, optimized library. Unlike bloated alternatives that require dozens of plugins and complex configurations, BitBonsai works **out of the box** with everything built-in.

Think of it as a media server's best friend:
- **Automated encoding** to modern codecs (HEVC, AV1)
- **Zero-plugin architecture** - everything just works
- **Beautiful, calming UI** inspired by Japanese bonsai philosophy
- **Multi-node distributed processing** for massive libraries
- **Intelligent policy system** that learns your preferences
- **Environment-aware setup** for Unraid, Docker, Kubernetes

### Why BitBonsai?

**Traditional media tools are a nightmare:**
- Unmanic requires 47 plugins and 200 config options
- Tdarr has a confusing UI and limited codec support
- HandBrake is manual and non-scalable
- Commercial solutions cost $500+/year for basic features

**BitBonsai is different:**
- ✅ Install once, works forever
- ✅ TRUE RESUME - Never lose progress on interrupted encodes (crash recovery)
- ✅ Auto-Heal - Automatically resurrects orphaned jobs after crashes (4-layer defense)
- ✅ Beautiful UI you'll actually enjoy using
- ✅ Priority Queue - Pin urgent jobs to the top with dynamic prioritization
- ✅ Smart defaults that work for 95% of users
- ✅ Scale from single node to 100+ nodes (commercial tier)
- ✅ Fair pricing: free for home use, affordable for professionals

---

## Features

### Core Features (All Tiers)

| Feature | Description |
|---------|-------------|
| 🎬 **Zero-Plugin Architecture** | All codecs, containers, and filters built-in. No plugin hunting. |
| 🔄 **TRUE RESUME** | Resume interrupted encoding jobs from exact progress - never restart from scratch after crashes |
| 🛡️ **Auto-Heal System** | 4-layer crash recovery automatically resurrects orphaned jobs after backend restarts |
| 📊 **Beautiful Analytics Dashboard** | Real-time insights into codec distribution, storage savings, and encoding progress |
| 🎨 **Ultra Compact Overview** | Redesigned dashboard with space-efficient node tiles showing all critical metrics at a glance |
| 🎯 **Priority Queue System** | Pin urgent jobs to the top - dynamic priority management with visual indicators |
| 📚 **Library Filtering** | Filter queue by library for multi-library setups - find what matters instantly |
| 🔄 **Smart Policy System** | Create encoding rules once, apply to entire library automatically |
| ⚡ **Live Progress Tracking** | Watch your library transform in real-time with WebSocket updates, FPS, and ETA |
| 🎯 **Codec Intelligence** | Automatic detection of H.264, H.265/HEVC, AV1, VP9, and legacy codecs |
| 📈 **Per-Node Statistics** | Monitor encoding performance, job distribution, and resource usage for each node |
| 💾 **Storage Optimization** | See potential space savings before encoding (typical: 40-60% reduction) |
| 🔒 **Privacy-First** | Self-hosted, no telemetry, no phone-home |
| 🐳 **Docker Native** | One-command deployment for Unraid, Docker, Kubernetes |
| 📱 **Responsive Design** | Manage your library from desktop, tablet, or mobile |

### Commercial Features

| Feature | Free | Patreon | Starter | Pro | Enterprise |
|---------|------|---------|---------|-----|------------|
| **Nodes** | 1 | 1 | 3 | 10 | Unlimited |
| **Concurrent Jobs** | 5 | 10 | 50 | Unlimited | Unlimited |
| **Database** | SQLite | SQLite | PostgreSQL | PostgreSQL | PostgreSQL |
| **Job Queue** | In-Memory | In-Memory | Redis/BullMQ | Redis/BullMQ | Redis/BullMQ |
| **Distributed Encoding** | ❌ | Limited (2 files/child) | ✅ | ✅ | ✅ |
| **Priority Support** | ❌ | ❌ | Email (48h) | Email (24h) | Slack/Phone (4h) |
| **Custom Policies** | 3 | 5 | Unlimited | Unlimited | Unlimited |
| **Advanced Analytics** | ❌ | ✅ | ✅ | ✅ | ✅ |
| **API Access** | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Hardware Encoding** | CPU | CPU+GPU | CPU+GPU | CPU+GPU | CPU+GPU |
| **SSO/LDAP** | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Pricing 💰

### Free Tier (MIT License)
**Perfect for home media servers**

- ✅ Single node encoding
- ✅ Up to 5 concurrent jobs
- ✅ SQLite database
- ✅ All core features
- ✅ Community support via GitHub

**[Get Started Free](#quick-start)**

---

### Patreon Supporter ($5/month)
**Support development, get early access**

- ✅ Everything in Free
- ✅ 10 concurrent jobs
- ✅ Multi-node support (2 files per child node)
- ✅ Advanced analytics dashboard
- ✅ Priority feature requests
- ✅ Early access to new features (7 days before release)

**[Support on Patreon →](https://patreon.com/lucidfabrics)**

---

### Commercial Licenses
**For professional use, businesses, and power users**

#### Starter License - $29/year
**Perfect for growing libraries**

- ✅ 3 encoding nodes
- ✅ 50 concurrent jobs
- ✅ PostgreSQL database
- ✅ Redis/BullMQ job queue
- ✅ Full distributed encoding
- ✅ API access
- ✅ Email support (48h response)
- ✅ Commercial use allowed

**[Purchase Starter License →](https://buy.lucidfabrics.com/bitbonsai/starter)**

---

#### Professional License - $99/year
**For serious media enthusiasts and small teams**

- ✅ 10 encoding nodes
- ✅ Unlimited concurrent jobs
- ✅ PostgreSQL + Redis/BullMQ
- ✅ Hardware encoding (NVENC, QuickSync, AMF)
- ✅ Advanced scheduling (off-peak encoding)
- ✅ Webhook integrations
- ✅ Email support (24h response)
- ✅ Commercial use allowed

**[Purchase Pro License →](https://buy.lucidfabrics.com/bitbonsai/pro)**

---

#### Enterprise License - $299/year
**For businesses, data centers, and large-scale operations**

- ✅ Unlimited encoding nodes
- ✅ Unlimited concurrent jobs
- ✅ High-availability PostgreSQL cluster
- ✅ SSO/LDAP authentication
- ✅ Custom encoding profiles
- ✅ White-label UI (optional)
- ✅ Slack/Phone support (4h response)
- ✅ SLA guarantees
- ✅ Dedicated account manager
- ✅ Commercial use allowed

**[Contact Sales →](mailto:sales@lucidfabrics.com)**

---

### Volume Discounts

**Multiple licenses?** Contact us for:
- 5-10 licenses: 15% discount
- 11-25 licenses: 25% discount
- 26+ licenses: 35% discount + custom support

---

## Quick Start

### Docker (Recommended)

```bash
# Free tier - Single node
docker run -d \
  --name=bitbonsai \
  --restart=unless-stopped \
  -p 3000:3000 \
  -e TZ=America/New_York \
  -v /mnt/user/media:/media \
  -v /mnt/user/appdata/bitbonsai:/data \
  lucidfabrics/bitbonsai:latest
```

Access BitBonsai at `http://localhost:3000`

### Docker Compose

```yaml
version: '3.8'

services:
  bitbonsai:
    image: lucidfabrics/bitbonsai:latest
    container_name: bitbonsai
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - TZ=America/New_York
      - LICENSE_KEY=${LICENSE_KEY:-free}  # Add your license key here
    volumes:
      - /mnt/user/media:/media              # Your media library
      - /mnt/user/appdata/bitbonsai:/data   # BitBonsai database
    devices:
      - /dev/dri:/dev/dri  # For hardware encoding (Intel QuickSync)
```

### Unraid

1. Open Unraid WebUI → **Apps** tab
2. Search for **"BitBonsai"**
3. Click **Install**
4. Configure media paths
5. Add license key (if commercial)
6. Click **Apply**

Access via Unraid dashboard or `http://YOUR_SERVER_IP:3000`

### Adding Encoding Nodes (Commercial Tier)

```bash
# Master node (already running)
# ...

# Child node 1
docker run -d \
  --name=bitbonsai-worker-1 \
  --restart=unless-stopped \
  -e MASTER_URL=http://bitbonsai-master:3000 \
  -e NODE_TYPE=worker \
  -e LICENSE_KEY=your-commercial-key \
  -v /mnt/user/media:/media \
  lucidfabrics/bitbonsai-worker:latest

# Child node 2
docker run -d \
  --name=bitbonsai-worker-2 \
  --restart=unless-stopped \
  -e MASTER_URL=http://bitbonsai-master:3000 \
  -e NODE_TYPE=worker \
  -e LICENSE_KEY=your-commercial-key \
  -v /mnt/user/media:/media \
  lucidfabrics/bitbonsai-worker:latest
```

### Node Discovery & Pairing

BitBonsai supports **two methods** for connecting child nodes to your MAIN node:

#### 1. Auto-Discovery (mDNS/Bonjour) - Recommended

**How it works:**
- MAIN node broadcasts its presence on the local network using mDNS (`_bitbonsai._tcp.local`)
- Child nodes scan for available MAIN nodes
- User selects from discovered nodes and enters pairing code
- Fully automated - no manual IP address entry required

**Docker Configuration Requirement:**
> ⚠️ **CRITICAL**: mDNS broadcasts **only work with host networking mode**

For auto-discovery to function, your MAIN node Docker container must use `--network=host`:

```bash
# MAIN node with auto-discovery enabled
docker run -d \
  --name=bitbonsai \
  --network=host \           # Required for mDNS broadcasts
  --restart=unless-stopped \
  -e TZ=America/New_York \
  -v /mnt/user/media:/media \
  -v /mnt/user/appdata/bitbonsai:/data \
  lucidfabrics/bitbonsai:latest
```

**Docker Compose with host networking:**
```yaml
services:
  bitbonsai:
    image: lucidfabrics/bitbonsai:latest
    network_mode: host        # Required for mDNS
    restart: unless-stopped
    environment:
      - TZ=America/New_York
    volumes:
      - /mnt/user/media:/media
      - /mnt/user/appdata/bitbonsai:/data
```

**When to use:**
- Single subnet/VLAN (mDNS doesn't cross VLANs)
- You control the Docker host configuration
- Prefer automatic node discovery
- All nodes on same local network

#### 2. Manual Pairing - Universal

**How it works:**
- User manually enters MAIN node URL (e.g., `http://192.168.1.100:4210`)
- Child node requests pairing token from MAIN node
- User enters pairing code
- Works across any network configuration

**No special Docker configuration required** - works with bridge networking:

```bash
# MAIN node with manual pairing (bridge networking)
docker run -d \
  --name=bitbonsai \
  --restart=unless-stopped \
  -p 3000:3000 \              # Standard port mapping
  -e TZ=America/New_York \
  -v /mnt/user/media:/media \
  -v /mnt/user/appdata/bitbonsai:/data \
  lucidfabrics/bitbonsai:latest
```

**When to use:**
- Docker bridge networking (default)
- Nodes across different VLANs/subnets
- Remote nodes over VPN/WireGuard
- Firewall restrictions prevent mDNS
- Kubernetes/orchestrated deployments

#### Comparison

| Feature | Auto-Discovery (mDNS) | Manual Pairing |
|---------|----------------------|----------------|
| **Docker Networking** | Requires `--network=host` | Works with bridge mode |
| **Setup Complexity** | Automatic (scan & select) | Manual (enter IP/URL) |
| **Cross-VLAN Support** | ❌ No | ✅ Yes |
| **VPN/Remote Nodes** | ❌ No | ✅ Yes |
| **Firewall Friendly** | ⚠️ mDNS port 5353/UDP | ✅ Standard HTTP/HTTPS |
| **Best For** | Home networks, single subnet | Enterprise, VLANs, remote nodes |

**Recommendation:**
- **Home/lab networks**: Use auto-discovery with `--network=host` for convenience
- **Production/enterprise**: Use manual pairing for better security and firewall control
- **Mixed environments**: MAIN node supports both simultaneously - users choose at setup time

---

## Automatic SSH Key Exchange for File Transfers

BitBonsai automatically configures **passwordless SSH authentication** during node registration, enabling secure rsync file transfers between nodes without any manual terminal configuration.

### The Problem We Solve

Traditional multi-node encoding systems require manual SSH setup:
```bash
# Old way - manual SSH configuration (error-prone)
ssh child-node
ssh-keygen -t rsa -b 4096
cat ~/.ssh/id_rsa.pub  # Copy this manually
ssh main-node
echo "ssh-rsa AAAAB3..." >> ~/.ssh/authorized_keys  # Paste child's key
exit
ssh main-node
cat ~/.ssh/id_rsa.pub  # Copy main's key
ssh child-node
echo "ssh-rsa AAAAB3..." >> ~/.ssh/authorized_keys  # Paste main's key
```

**BitBonsai's Solution**: Zero-configuration SSH setup - just like Proxmox cluster join.

### How It Works

#### 1. Automatic Key Generation (On Container Startup)

When any BitBonsai node starts, it automatically:
- Generates a 4096-bit RSA keypair (`~/.ssh/id_rsa`, `~/.ssh/id_rsa.pub`)
- Sets proper permissions (600 for private key, 644 for public key)
- Stores keys in persistent volume (survives container restarts)
- Skips generation if keys already exist

**No manual intervention required** - happens automatically on first startup.

#### 2. Child Node Registration (Automatic Key Exchange)

When a child node joins the cluster:

```
┌─────────────────────────────────────────────────────────────┐
│ CHILD NODE                                                  │
│                                                             │
│ 1. User clicks "Register with Main Node"                   │
│ 2. Frontend fetches child's SSH public key                 │
│ 3. Registration request sent with SSH key included          │
│                                                             │
│    POST /api/v1/registration-requests                      │
│    {                                                        │
│      "mainNodeId": "abc123",                               │
│      "sshPublicKey": "ssh-rsa AAAAB3..."  ← Child's key   │
│    }                                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ MAIN NODE                                                   │
│                                                             │
│ 1. Admin approves registration request                     │
│ 2. Backend adds child's key to ~/.ssh/authorized_keys      │
│ 3. Backend fetches main's SSH public key                   │
│ 4. Response includes main's SSH key                         │
│                                                             │
│    Response:                                                │
│    {                                                        │
│      "status": "APPROVED",                                  │
│      "mainNodePublicKey": "ssh-rsa AAAAB3..."  ← Main's key│
│      "apiKey": "bb_abc123..."                              │
│    }                                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ CHILD NODE (Automatic SSH Setup)                           │
│                                                             │
│ 1. Frontend detects approval (polling every 5 seconds)     │
│ 2. Frontend adds main's key to child's authorized_keys     │
│ 3. Bidirectional SSH authentication now configured         │
│ 4. Child redirects to dashboard - ready for file transfers │
└─────────────────────────────────────────────────────────────┘
```

**Total user interaction**: 2 clicks (register + approve)

**SSH configuration time**: 0 seconds (fully automatic)

### 3. File Transfer Detection

When a child node doesn't have shared storage access (NFS/SMB), BitBonsai automatically:

1. **Detects transfer requirement** - Checks `hasSharedStorage` flag on child node
2. **Initiates rsync transfer** - Uses passwordless SSH for secure file transfer
3. **Monitors progress** - Tracks transfer percentage and speed
4. **Starts encoding** - Begins encoding only after transfer completes

**Example workflow:**
```
Job: "The Matrix (1999).mkv" on MAIN node
↓
Assigned to CHILD node (no shared storage)
↓
BitBonsai detects: transferRequired = true
↓
rsync -avz --progress root@192.168.1.100:/media/Movies/Matrix.mkv /tmp/
↓
Transfer: 100% (5.2 GB transferred)
↓
Encoding starts on CHILD node
↓
Encoded file transferred back to MAIN node
↓
Job completed ✓
```

### Security Features

**🔒 Strong Encryption**
- 4096-bit RSA keys (industry standard)
- Secure key generation using `ssh-keygen`
- Keys never exposed in UI or logs

**🛡️ Automatic Key Management**
- Keys stored in persistent Docker volumes
- Proper UNIX permissions enforced (600/644/700)
- Automatic deduplication prevents duplicate keys

**🔐 Bidirectional Authentication**
- Both MAIN and CHILD nodes authenticate each other
- Prevents man-in-the-middle attacks
- Uses SSH's built-in security (same as GitHub, AWS, etc.)

### File Transfer Methods: NFS vs Rsync

BitBonsai intelligently chooses the optimal file transfer method:

| Storage Type | Transfer Method | Use Case |
|--------------|-----------------|----------|
| **Shared Storage (NFS/SMB)** | Direct access | Child mounts same network share as MAIN |
| **No Shared Storage** | Rsync over SSH | Files transferred before encoding |

**Automatic Detection**:
- During node registration, BitBonsai tests for shared storage access
- Sets `hasSharedStorage` flag on child node
- Job assignment logic automatically triggers rsync when needed

**Benefits of Rsync over SSH**:
- ✅ Works across any network topology (local, VPN, internet)
- ✅ Resume interrupted transfers (built-in)
- ✅ Bandwidth throttling (prevents network saturation)
- ✅ Compression (reduces transfer time)
- ✅ Secure (encrypted via SSH tunnel)

### Manual SSH Key Management (Optional)

While BitBonsai handles everything automatically, you can manually manage SSH keys if needed:

**View this node's public key:**
```bash
curl http://localhost:3000/api/v1/nodes/ssh/public-key
```

**Add a remote node's public key:**
```bash
curl -X POST http://localhost:3000/api/v1/nodes/ssh/authorized-keys \
  -H "Content-Type: application/json" \
  -d '{"publicKey": "ssh-rsa AAAAB3...", "comment": "custom-node"}'
```

**Test SSH connection:**
```bash
# From child node
ssh root@192.168.1.100 echo "SSH OK"
```

### Troubleshooting

**Issue**: File transfer fails with "Permission denied (publickey)"

**Solution**:
1. Check SSH keys are generated:
   ```bash
   docker exec bitbonsai-backend ls -la ~/.ssh/
   ```
2. Verify authorized_keys contains remote key:
   ```bash
   docker exec bitbonsai-backend cat ~/.ssh/authorized_keys
   ```
3. Test SSH manually:
   ```bash
   docker exec bitbonsai-backend ssh -o StrictHostKeyChecking=no root@REMOTE_IP echo "test"
   ```

**Issue**: Child node can't access main node via SSH

**Solutions**:
- Ensure main node's backend container port 22 is accessible (or use custom SSH port)
- Check firewall rules allow SSH traffic between nodes
- Verify IP addresses are correct in node configuration

**Issue**: SSH keys not persistent after container restart

**Solution**: Ensure `~/.ssh` directory is mapped to a persistent volume:
```yaml
volumes:
  - /mnt/user/appdata/bitbonsai:/root/.ssh  # Persists SSH keys
```

### Benefits Over Manual Configuration

| Traditional SSH Setup | BitBonsai Automatic |
|----------------------|---------------------|
| 15-30 minutes manual work | 2 clicks, instant |
| Requires SSH expertise | Zero technical knowledge |
| Error-prone (typos, permissions) | Automated, reliable |
| Per-node configuration | One-time setup |
| Manual testing required | Auto-verified |

**User Experience**: Like Proxmox cluster join - professional-grade automation for home users.

---

## How It Works

### 1. Scan Your Library
Point BitBonsai at your media directories. It intelligently scans for:
- Movies, TV shows, anime, home videos
- Codec distribution (H.264, HEVC, AV1, etc.)
- File sizes and bitrates
- Encoding inefficiencies

### 2. Create Policies
Define encoding rules once:
```
Policy: "Optimize TV Shows"
- Source: /media/TV
- Target Codec: HEVC (H.265)
- Quality: CRF 23
- Audio: Copy all tracks
- Subtitles: Copy all tracks
- Hardware: Use NVENC if available
- Scheduling: Off-peak hours (2 AM - 6 AM)
```

### 3. Watch It Work
BitBonsai automatically:
- Queues files for encoding
- Distributes work across available nodes (commercial tier)
- Monitors progress with live updates
- Verifies encoded files
- Replaces originals (or saves alongside - your choice)
- Updates media server libraries (Plex/Jellyfin/Emby)

### 4. Enjoy the Results
Typical results:
- **40-60% storage savings** (H.264 → HEVC)
- **60-70% storage savings** (H.264 → AV1)
- **Same or better visual quality**
- **Faster streaming** (modern codecs are more efficient)

---

## 🛡️ TRUE RESUME & Auto-Heal: Never Lose Progress Again

**The Problem with Traditional Encoders:**
Ever had a 12-hour encoding job crash at 98%? With traditional tools, you start from scratch. BitBonsai's TRUE RESUME system ensures you never waste time re-encoding.

### TRUE RESUME Technology

When encoding is interrupted (crash, restart, power loss), BitBonsai:
1. **Preserves exact progress** - Tracks encoding position down to the frame
2. **Validates temp files** - Ensures partial encodes are safe to resume
3. **Resumes from timestamp** - FFmpeg continues from `HH:MM:SS` position, not 0%
4. **Prevents data loss** - Original files never touched until verification succeeds

**Real-World Example:**
```
Job: "Avengers Endgame (2019) 4K.mkv" (25GB, 3h 2m runtime)
Progress: 33.22% complete when backend crashed
Traditional tool: Restart from 0% (lose 1 hour of work)
BitBonsai TRUE RESUME: Resume from 00:33:00 (save 1 hour)
```

### Auto-Heal System: 4-Layer Crash Recovery

BitBonsai's auto-heal system uses a sophisticated 4-layer defense against crashes and Docker volume mount race conditions:

**Layer 1: Initial Delay** (2 seconds)
- Basic container initialization
- Prevents premature file system access

**Layer 2: Volume Mount Probing** (10 retries @ 1 second)
- Actively checks if media paths exist
- Waits for Docker volumes to fully mount
- Critical for container orchestration (Docker Compose, Kubernetes)

**Layer 3: Stabilization Delay** (3 seconds)
- File system settling time
- Ensures FUSE/NFS/SMB mounts are responsive

**Layer 4: Temp File Validation** (5 retries @ 1 second)
- Verifies partial encodes still exist
- Distinguishes between "resume from progress" vs "restart from 0%"

**Auto-Heal in Action:**
```
[08:00:00] Backend started
[08:00:02] 🔍 Scanning for orphaned jobs...
[08:00:02] ✅ Volume mount ready: /media/Movies
[08:00:05] 🔄 Found 15 orphaned jobs
[08:00:06] ✅ TRUE RESUME: Temp file found for "Star Wars.mkv"
[08:00:06] ✅ TRUE RESUME: Will resume from 00:01:19 (1.06% of 2h 4m)
[08:00:06] ✅ 15 jobs reset to QUEUED
[08:00:07] 🚀 Encoding resumed automatically
```

**Benefits:**
- **Zero manual intervention** - Jobs auto-resume after crashes
- **Production-tested** - 4-layer defense handles Docker, Unraid, Kubernetes
- **Progress preservation** - Never lose hours of encoding work
- **Safe fallback** - If temp file missing, safely restarts from 0%

This is why BitBonsai is "rock solid" for 24/7 encoding workloads.

---

## Why BitBonsai vs Alternatives?

| Feature | BitBonsai | Unmanic | Tdarr | HandBrake | FileFlows |
|---------|-----------|---------|-------|-----------|-----------|
| **Zero-Plugin Architecture** | ✅ | ❌ (47+ plugins) | ❌ (100+ plugins) | ✅ | ❌ |
| **TRUE RESUME (Crash Recovery)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Auto-Heal System** | ✅ 4-layer | ❌ | ❌ | ❌ | ⚠️ Basic |
| **Priority Queue** | ✅ Dynamic | ❌ | ⚠️ Static | ❌ | ✅ |
| **Library Filtering** | ✅ | ❌ | ⚠️ | ❌ | ✅ |
| **Beautiful UI** | ✅ | ❌ | ❌ | ⚠️ | ⚠️ |
| **Multi-Node (Out of Box)** | ✅ | ❌ | ✅ | ❌ | ✅ |
| **Hardware Encoding** | ✅ | ⚠️ (plugin) | ✅ | ✅ | ✅ |
| **Smart Policies** | ✅ | ⚠️ (complex) | ⚠️ (complex) | ❌ | ✅ |
| **Real-Time Analytics** | ✅ | ❌ | ⚠️ | ❌ | ❌ |
| **Per-Node Statistics** | ✅ | ❌ | ⚠️ | ❌ | ✅ |
| **FPS Display** | ✅ | ❌ | ✅ | ⚠️ | ✅ |
| **Free Tier** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Commercial Pricing** | $29-299/yr | Free only | $10/mo | N/A | $20/mo |
| **Setup Time** | 5 minutes | 2+ hours | 3+ hours | N/A | 1 hour |

---

## Documentation

### Getting Started
- [Installation Guide](./docs/installation.md)
- [First-Time Setup](./docs/setup.md)
- [Creating Policies](./docs/policies.md)
- [Multi-Node Configuration](./docs/multi-node.md)

### Advanced Topics
- [Hardware Encoding Setup](./docs/hardware-encoding.md)
- [PostgreSQL Configuration](./docs/postgresql.md)
- [Redis/BullMQ Setup](./docs/redis.md)
- [API Reference](./docs/api.md)

### Integration
- [Unraid Template](./unraid/README.md)
- [Plex Integration](./docs/plex.md)
- [Jellyfin Integration](./docs/jellyfin.md)
- [Emby Integration](./docs/emby.md)

### Development
- [Contributing Guidelines](./CONTRIBUTING.md)
- [Code Conventions](./code-conventions/README.md)
- [Angular Guidelines](./code-conventions/angular-guidelines.md)
- [NestJS Guidelines](./code-conventions/nestjs-guidelines.md)
- [Building from Source](./docs/building.md)

---

## Development

### Prerequisites
- Node.js 20+ LTS
- Docker 24+
- Angular CLI 19+
- NestJS CLI 10+
- FFmpeg 7.1+ (John Van Sickle static builds included in Docker images)

### Local Development

```bash
# Clone repository
git clone https://github.com/lucidfabrics/bitbonsai.git
cd bitbonsai

# Install dependencies
npm install

# Run frontend + backend (with HMR)
npx nx dev

# Frontend: http://localhost:4200
# Backend: http://localhost:3000/api/v1
```

### Docker Development

```bash
# Run full stack with hot reload
npx nx docker:dev

# Stop development environment
npx nx docker:dev:down
```

### Building

```bash
# Build frontend
npm run build

# Build backend
npm run build:api

# Build Docker image
npm run docker:build

# Build and push to Docker Hub
npm run docker:build-push
```

### Testing

```bash
# Run all tests with coverage
npm test

# Run frontend tests
npx nx test frontend

# Run backend tests
npx nx test backend

# E2E tests (Playwright)
npm run test:e2e

# Code quality check
npm run check

# Auto-fix linter issues
npm run check:fix
```

### Git Hooks & Quality Gates

BitBonsai enforces code quality through automated Git hooks powered by **Husky**:

#### Pre-commit Hook
Automatically runs before each commit:
- Runs Biome linter and auto-fixes issues
- Stages fixed files
- Verifies zero linter errors remain
- **Prevents commits with code quality issues**

#### Pre-push Hook
Automatically runs before pushing to remote:
- Builds backend and frontend (ensures compilation success)
- Runs all unit and integration tests
- Runs Playwright E2E tests
- Verifies test coverage ≥95%
- **Prevents pushing broken code**

#### Bypassing Hooks (Not Recommended)
```bash
# Only use in emergencies with explicit approval
git commit --no-verify
git push --no-verify
```

**Note**: All contributions MUST pass these quality gates. CI/CD will reject PRs that bypass hooks.

---

## Contributing

We welcome contributions! Before submitting:

1. **Read our [Code Conventions](./code-conventions/README.md)**
2. **Follow [Angular Guidelines](./code-conventions/angular-guidelines.md)** for frontend
3. **Follow [NestJS Guidelines](./code-conventions/nestjs-guidelines.md)** for backend
4. **Write tests** per [Testing Guidelines](./code-conventions/testing-guidelines.md)
5. **Use proper [Git Workflow](./code-conventions/git-commit-instructions.md)**

### Development Philosophy

BitBonsai follows these principles:
- **Simplicity over complexity** - Zero plugins, sensible defaults
- **Beauty over utility** - UX matters as much as functionality
- **Performance over features** - Fast, responsive, scalable
- **Privacy over convenience** - Self-hosted, no telemetry, no tracking

---

## Support

### Community Support (Free Tier)
- [GitHub Discussions](https://github.com/lucidfabrics/bitbonsai/discussions)
- [GitHub Issues](https://github.com/lucidfabrics/bitbonsai/issues)
- [Discord Community](https://discord.gg/lucidfabrics)

### Commercial Support
- **Starter**: Email support (48h response)
- **Professional**: Email support (24h response)
- **Enterprise**: Slack/Phone support (4h response) + SLA

**Contact**: [support@lucidfabrics.com](mailto:support@lucidfabrics.com)

---

## License

BitBonsai uses a **dual-license model**:

### MIT License (Free Tier)
The core BitBonsai software is licensed under the [MIT License](./LICENSE-MIT.md) for non-commercial, single-node use.

**You can freely:**
- Use BitBonsai for personal media libraries
- Modify the source code
- Distribute copies
- Use for non-commercial projects

**Limitations:**
- Single node only
- SQLite database
- Up to 5 concurrent jobs

### Commercial License (Paid Tiers)
Commercial features (multi-node, PostgreSQL, Redis/BullMQ, hardware encoding, etc.) require a paid license.

**[View Commercial License Terms →](./LICENSE-COMMERCIAL.md)**

**[Purchase Commercial License →](https://buy.lucidfabrics.com/bitbonsai)**

---

## Support the Project

If BitBonsai saves you storage space and keeps your library organized, consider supporting development:

### One-Time Donations
[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/lucidfabrics)

### Monthly Support
[![Become a Patron](https://img.shields.io/badge/Patreon-Support%20Development-FF424D?style=for-the-badge&logo=patreon)](https://patreon.com/lucidfabrics)

Your support enables:
- Faster feature development
- Better documentation
- Improved hardware encoding support
- More codec options (AV1, VP9, etc.)
- Enhanced multi-node capabilities

---

## Roadmap

### ✅ Recently Completed (October 2025)
- [x] **TRUE RESUME** - Resume interrupted encoding jobs from exact progress
- [x] **Auto-Heal System** - 4-layer crash recovery with volume mount race condition defense
- [x] **Priority Queue** - Dynamic job prioritization with visual indicators
- [x] **Library Filtering** - Filter queue by library for multi-library setups
- [x] **Per-Node Statistics** - Monitor encoding performance for each node
- [x] **FPS Display** - Real-time frames per second for active encodes
- [x] **Failed At Timestamps** - Track when jobs failed with human-readable timestamps
- [x] **Ultra Compact Overview** - Redesigned dashboard with space-efficient node tiles

### v0.2 (Q1 2026)
- [ ] AV1 encoding support (codec integration)
- [ ] Advanced scheduling (off-peak hours, cron expressions)
- [ ] Webhook integrations (Discord, Slack, custom endpoints)
- [ ] Enhanced retry logic with exponential backoff
- [ ] Bulk job operations (retry all failed, clear completed)
- [ ] Export queue data (CSV, JSON)

### v0.3 (Q2 2026)
- [ ] Machine learning quality prediction (CRF optimization)
- [ ] Auto-tagging and metadata extraction
- [ ] Multi-user support with permissions (RBAC)
- [ ] Cloud storage integration (S3, B2, Wasabi)
- [ ] Mobile app (iOS/Android)
- [ ] Advanced filtering (by codec, resolution, size range)

### v1.0 (Q4 2026)
- [ ] Enterprise SSO/LDAP
- [ ] High-availability clustering (PostgreSQL replication)
- [ ] White-label UI options
- [ ] Professional SLA support
- [ ] Real-time collaboration (shared queue management)
- [ ] Comprehensive audit logs

[View Full Roadmap →](./ROADMAP.md)

---

## Credits

**Created by [Lucid Fabrics](https://lucidfabrics.com)**

BitBonsai is built with:
- [Angular 19](https://angular.dev) - Modern web framework
- [NestJS 10](https://nestjs.com) - Progressive Node.js framework
- [NgRx](https://ngrx.io) - Reactive state management
- [PostgreSQL](https://postgresql.org) - Robust database
- [Redis](https://redis.io) - High-performance caching
- [BullMQ](https://bullmq.io) - Distributed job queue
- [FFmpeg 7.1+](https://ffmpeg.org) - Media encoding powerhouse ([John Van Sickle static builds](https://johnvansickle.com/ffmpeg/))

Special thanks to the open-source community for making this possible.

---

## FAQ

**Q: Why the name "BitBonsai"?**
A: Bonsai trees are meticulously pruned and shaped over time. Your media library deserves the same care - removing waste (inefficient codecs) while preserving beauty (video quality).

**Q: How is this different from Unmanic?**
A: Unmanic requires 47+ plugins and complex configuration. BitBonsai works out of the box with zero plugins and a beautiful UI.

**Q: Can I try commercial features before buying?**
A: Yes! Commercial licenses include a 30-day money-back guarantee. No questions asked.

**Q: Do I need to stop Plex/Jellyfin while encoding?**
A: No! BitBonsai can encode files while your media server continues streaming.

**Q: What about audio and subtitles?**
A: By default, all audio tracks and subtitles are preserved. You can customize this per policy.

**Q: Does this work on Windows/Mac/Linux?**
A: BitBonsai runs anywhere Docker runs. We officially support Linux (Unraid, Ubuntu, Debian) and macOS. Windows support is community-maintained.

**Q: Can I encode from one location to another?**
A: Yes! You can configure source and destination paths per policy.

**Q: What happens if encoding fails?**
A: BitBonsai automatically retries failed jobs 3 times. Original files are never deleted until successful verification.

**Q: What happens if my server crashes during encoding?**
A: BitBonsai's TRUE RESUME system automatically detects interrupted jobs and resumes from the exact timestamp (down to the frame). You never lose progress. If the temp file is missing, it safely restarts from 0%. No manual intervention required.

**Q: How does Auto-Heal work?**
A: On startup, BitBonsai scans for orphaned jobs (ENCODING, HEALTH_CHECK, VERIFYING states). It validates temp files, calculates resume positions, and automatically requeues jobs. The 4-layer system handles Docker volume mount race conditions, ensuring reliability on Unraid, Docker Compose, and Kubernetes.

**Q: Why can't my child node discover the MAIN node?**
A: mDNS auto-discovery requires `--network=host` on your MAIN node Docker container. Standard bridge networking blocks mDNS broadcasts. If you can't use host networking (e.g., Unraid, Docker Compose with port conflicts), use the **Manual Pairing** option instead - it works across any network configuration. See [Node Discovery & Pairing](#node-discovery--pairing) for details.

**Q: Can I use both auto-discovery and manual pairing?**
A: Yes! The MAIN node supports both methods simultaneously. Child nodes can choose their preferred method during setup. Auto-discovery is easier for home networks, while manual pairing works across VLANs, VPNs, and complex network topologies.

**Q: How does SSH key exchange work?**
A: BitBonsai automatically configures passwordless SSH authentication during node registration. When a child node joins the cluster, both nodes exchange SSH public keys, enabling secure rsync file transfers without manual configuration. See [Automatic SSH Key Exchange](#automatic-ssh-key-exchange-for-file-transfers) for details.

---

<div align="center">

**Made with ❤️ by [Lucid Fabrics](https://lucidfabrics.com)**

[Website](https://bitbonsai.dev) • [Documentation](./docs) • [GitHub](https://github.com/lucidfabrics/bitbonsai) • [Discord](https://discord.gg/lucidfabrics)

⭐ **Star us on GitHub if BitBonsai helps you!** ⭐

</div>
