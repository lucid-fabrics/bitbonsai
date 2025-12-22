# BitBonsai 🌳

> **Intelligent Video Encoding Platform for Media Servers**

<div align="center">

![Beta](https://img.shields.io/badge/Status-BETA-orange?style=flat-square)
[![Docker Pulls](https://img.shields.io/docker/pulls/lucidfabrics/bitbonsai?style=flat-square)](https://hub.docker.com/r/lucidfabrics/bitbonsai)
[![Docker Image](https://img.shields.io/badge/Docker-lucidfabrics%2Fbitbonsai-2496ED?style=flat-square&logo=docker)](https://hub.docker.com/r/lucidfabrics/bitbonsai)

**Transform your media library with automated, intelligent video encoding.**

Reduce storage by 40-60% while maintaining quality. Perfect for Plex, Jellyfin, and Emby.

[Features](#-features) • [Installation](#-installation) • [Quick Start](#-quick-start) • [Screenshots](#-screenshots) • [FAQ](#-faq)

</div>

---

## ⚠️ Beta Notice

BitBonsai is currently in **public beta**. Core features are stable, but you may encounter bugs.

**What to expect:**
- ✅ Core encoding features work reliably
- ✅ Multi-node distribution functional
- ✅ Hardware acceleration (NVIDIA, Intel QSV, AMD)
- ⚠️ Some UI polish still in progress
- ⚠️ Documentation being expanded

**Feedback welcome!** Report issues or suggestions via [GitHub Issues](https://github.com/lucid-fabrics/bitbonsai/issues).

---

## 🎯 What is BitBonsai?

BitBonsai is a **self-hosted video encoding platform** that automatically converts your media library to modern, efficient codecs (H.265/HEVC, AV1).

**The Problem:** Your media library is bloated with inefficient H.264 files. A single 4K movie can be 50GB+. Streaming stutters, storage fills up, and backups take forever.

**The Solution:** BitBonsai intelligently re-encodes your library, reducing storage by 40-60% with no visible quality loss. It's fully automated, self-healing, and works while you sleep.

### Why BitBonsai?

| Traditional Tools | BitBonsai |
|-------------------|-----------|
| 47+ plugins to configure | Zero plugins - everything built-in |
| Crashes lose all progress | **TRUE RESUME** - never restart from 0% |
| Manual retry on failures | **Auto-Heal** - self-recovers from crashes |
| Complex, confusing UI | Clean, intuitive interface |
| Single machine only | Multi-node distributed encoding |

---

## ✨ Features

### Core Encoding

| Feature | Description |
|---------|-------------|
| 🎬 **Smart Codec Detection** | Automatically identifies H.264, H.265, AV1, VP9 and legacy codecs |
| 🔄 **TRUE RESUME** | Resume interrupted jobs from exact timestamp - never lose progress |
| 🛡️ **Auto-Heal System** | 4-layer crash recovery automatically resurrects orphaned jobs |
| ⚡ **Hardware Acceleration** | NVIDIA NVENC, Intel QuickSync, AMD AMF support |
| 📊 **Real-Time Progress** | Live FPS, ETA, and encoding statistics |
| 💾 **Space Savings Preview** | See potential savings before encoding (40-60% typical) |

### Library Management

| Feature | Description |
|---------|-------------|
| 📚 **Multiple Libraries** | Organize Movies, TV Shows, Anime separately |
| 🎯 **Smart Policies** | Create encoding rules once, apply to entire libraries |
| 🔍 **Library Filtering** | Filter queue by library in multi-library setups |
| 📈 **Analytics Dashboard** | Visualize codec distribution, storage savings, encoding history |

### Multi-Node Distribution

| Feature | Description |
|---------|-------------|
| 🌐 **Distributed Encoding** | Spread work across multiple machines |
| 🔗 **Auto-Discovery** | mDNS/Bonjour for automatic node detection |
| 🔑 **SSH Key Exchange** | Automatic passwordless authentication between nodes |
| 📡 **NFS Auto-Mount** | Shared storage detection and configuration |
| 📊 **Per-Node Stats** | Monitor performance of each encoding node |

### Reliability

| Feature | Description |
|---------|-------------|
| ♻️ **Job Retry** | Automatic retry with exponential backoff |
| 🏥 **Health Checks** | Continuous monitoring of encoding jobs |
| 🔒 **Safe Encoding** | Original files preserved until verification succeeds |
| 📝 **Audit Trail** | Complete history of all encoding decisions |

### Integrations

| Feature | Description |
|---------|-------------|
| 🎬 **Jellyfin** | Auto-refresh libraries after encoding |
| 📺 **Plex** | Library scan triggers (coming soon) |
| 🔔 **Notifications** | Discord, Slack, email alerts (coming soon) |

---

## 📦 Installation

### Docker (Recommended)

```bash
docker run -d \
  --name bitbonsai \
  --network host \
  -e TZ=America/New_York \
  -e ADMIN_PASSWORD=changeme \
  -v /path/to/media:/media \
  -v /path/to/appdata:/data \
  -v /path/to/cache:/cache \
  lucidfabrics/bitbonsai:latest
```

### Docker Compose

```yaml
version: '3.8'

services:
  bitbonsai:
    image: lucidfabrics/bitbonsai:latest
    container_name: bitbonsai
    network_mode: host
    restart: unless-stopped
    environment:
      - TZ=America/New_York
      - ADMIN_PASSWORD=changeme        # Change this!
      - DATABASE_URL=file:/data/bitbonsai.db
      - MEDIA_PATHS=/media,/downloads
      - ENCODING_TEMP_PATH=/cache
    volumes:
      - /mnt/media:/media:rw           # Your media library
      - /mnt/downloads:/downloads:rw   # Optional: Downloads folder
      - ./appdata:/data:rw             # Database & config
      - ./cache:/cache:rw              # Temp encoding files (use SSD!)
    # For NVIDIA GPU:
    # runtime: nvidia
    # environment:
    #   - NVIDIA_VISIBLE_DEVICES=all

    # For Intel QuickSync:
    # devices:
    #   - /dev/dri:/dev/dri
```

### Unraid

1. Open **Apps** tab
2. Search for **"BitBonsai"**
3. Click **Install**
4. Configure paths (see below)
5. Click **Apply**

Access at `http://YOUR-SERVER:8108`

---

## 🚀 Quick Start

### 1. First Login

Navigate to `http://YOUR-SERVER:8108` and log in with:
- **Username:** `admin`
- **Password:** Your configured `ADMIN_PASSWORD`

### 2. Add a Library

1. Go to **Libraries** → **Add Library**
2. Enter a name (e.g., "Movies")
3. Select the path (`/media/Movies`)
4. Click **Save**

### 3. Create an Encoding Policy

1. Go to **Policies** → **Add Policy**
2. Configure:
   - **Name:** "HEVC Balanced"
   - **Source Codec:** H.264
   - **Target Codec:** H.265 (HEVC)
   - **Quality:** CRF 22 (balanced)
   - **Hardware:** Enable if GPU available
3. Click **Save**

### 4. Start Encoding

1. Go to **Queue**
2. Files matching your policy appear automatically
3. Click **Start Workers** to begin encoding
4. Watch real-time progress with FPS and ETA

### 5. Monitor Progress

- **Overview:** Dashboard with node status and encoding stats
- **Queue:** Active jobs with progress bars
- **Insights:** Analytics on codec distribution and savings

---

## 📸 Screenshots

### Dashboard Overview
*Clean, minimal dashboard showing node status, active jobs, and storage savings at a glance.*

### Queue Management
*Real-time job progress with FPS, ETA, and priority controls. Filter by library, retry failed jobs.*

### Policy Configuration
*Create smart encoding rules with codec selection, quality presets, and hardware acceleration options.*

### Multi-Node View
*Monitor distributed encoding across multiple machines with per-node statistics.*

> 📷 Screenshots coming soon - beta UI still being polished!

---

## ⚙️ Configuration

### Path Mappings

| Container Path | Purpose | Recommendation |
|----------------|---------|----------------|
| `/media` | Media library | Your movies/TV shows |
| `/downloads` | Downloads folder | For *arr integration |
| `/data` | Database & config | Persistent storage |
| `/cache` | Temp encoding files | **Use SSD for 10-100x faster encoding!** |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PASSWORD` | (required) | Admin login password |
| `TZ` | `UTC` | Timezone (e.g., `America/New_York`) |
| `DATABASE_URL` | `file:/data/bitbonsai.db` | Database location |
| `MEDIA_PATHS` | `/media` | Comma-separated scan paths |
| `ENCODING_TEMP_PATH` | `/cache` | Temp file location |
| `MAX_CONCURRENT_JOBS` | `2` | Parallel encoding jobs |
| `LOG_LEVEL` | `info` | Logging verbosity |

### Hardware Acceleration

#### NVIDIA GPU (NVENC)
```yaml
services:
  bitbonsai:
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
```

#### Intel QuickSync
```yaml
services:
  bitbonsai:
    devices:
      - /dev/dri:/dev/dri
```

#### AMD GPU (AMF)
```yaml
services:
  bitbonsai:
    devices:
      - /dev/dri/renderD128:/dev/dri/renderD128
```

---

## 🌐 Multi-Node Setup

BitBonsai can distribute encoding across multiple machines for faster processing.

### Architecture

```
┌─────────────────┐
│   MAIN NODE     │  ← Manages database, assigns jobs
│  (Your Server)  │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│ CHILD  │ │ CHILD  │  ← Execute encoding jobs
│ NODE 1 │ │ NODE 2 │
└────────┘ └────────┘
```

### MAIN Node (Primary Server)

```yaml
services:
  bitbonsai:
    image: lucidfabrics/bitbonsai:latest
    network_mode: host  # Required for node discovery
    environment:
      - NODE_ROLE=MAIN
      - ADMIN_PASSWORD=changeme
    volumes:
      - /mnt/media:/media
      - ./appdata:/data
```

### CHILD Node (Worker)

```yaml
services:
  bitbonsai-worker:
    image: lucidfabrics/bitbonsai:latest
    network_mode: host
    environment:
      - NODE_ROLE=LINKED
      - MAIN_NODE_URL=http://192.168.1.100:8108
    volumes:
      - /mnt/media:/media  # Same NFS mount as MAIN
```

### Node Discovery Methods

| Method | Requirements | Best For |
|--------|--------------|----------|
| **Auto-Discovery (mDNS)** | `network_mode: host` | Home networks |
| **Manual Pairing** | Enter MAIN URL | VLANs, VPNs, enterprise |

### Storage Sharing

| Type | Description |
|------|-------------|
| **Shared Storage (NFS/SMB)** | CHILD mounts same network share as MAIN - zero file transfer |
| **File Transfer (rsync)** | Files copied via SSH before encoding - works anywhere |

BitBonsai automatically detects shared storage and chooses the optimal method.

---

## 🔧 TRUE RESUME & Auto-Heal

### The Problem

Traditional encoders restart from 0% if interrupted. A 12-hour job crashes at 98%? Start over.

### BitBonsai's Solution

**TRUE RESUME** tracks encoding progress to the exact frame. After a crash:
1. Detects interrupted jobs on startup
2. Validates temp files exist
3. Resumes from exact timestamp (e.g., `01:45:30`)
4. No manual intervention required

**Example:**
```
Job: "Avengers Endgame 4K.mkv" (25GB, 3h runtime)
Crashed at: 67% (2h encoded)
Traditional: Restart from 0% (lose 2 hours)
BitBonsai: Resume from 02:00:00 (save 2 hours)
```

### Auto-Heal 4-Layer Defense

| Layer | Purpose |
|-------|---------|
| **1. Initial Delay** | Container initialization |
| **2. Volume Probing** | Wait for Docker mounts |
| **3. Stabilization** | NFS/FUSE settling time |
| **4. Temp Validation** | Verify partial encodes exist |

This handles Docker, Unraid, Kubernetes, and complex storage setups.

---

## ❓ FAQ

<details>
<summary><b>What codecs are supported?</b></summary>

**Input:** H.264, H.265/HEVC, AV1, VP9, MPEG-2, MPEG-4, and most legacy codecs

**Output:** H.265/HEVC, AV1 (coming soon)
</details>

<details>
<summary><b>Will this affect my video quality?</b></summary>

No visible quality loss with default settings (CRF 22-23). BitBonsai uses conservative presets that prioritize quality. You can adjust quality settings per policy.
</details>

<details>
<summary><b>How much storage will I save?</b></summary>

Typical savings:
- **H.264 → H.265:** 40-60% smaller
- **H.264 → AV1:** 50-70% smaller

BitBonsai shows estimated savings before encoding.
</details>

<details>
<summary><b>Does this work with Plex/Jellyfin/Emby?</b></summary>

Yes! BitBonsai can trigger library refreshes after encoding. Currently supports Jellyfin natively, with Plex/Emby coming soon.
</details>

<details>
<summary><b>What happens if encoding fails?</b></summary>

1. Original file is **never deleted** until verification succeeds
2. Failed jobs automatically retry (3 attempts with exponential backoff)
3. Persistent failures are flagged for manual review
</details>

<details>
<summary><b>Can I encode while streaming?</b></summary>

Yes! BitBonsai runs as a background process. You can continue streaming while encoding happens. Use the "Nice Level" setting to prioritize streaming.
</details>

<details>
<summary><b>What about audio and subtitles?</b></summary>

By default, all audio tracks and subtitles are preserved. You can configure this per policy (e.g., keep only specific languages).
</details>

<details>
<summary><b>Does it work on Windows?</b></summary>

BitBonsai runs anywhere Docker runs. Officially supported: Linux (Unraid, Ubuntu, Debian), macOS. Windows via Docker Desktop works but is community-supported.
</details>

<details>
<summary><b>Why does mDNS discovery not work?</b></summary>

mDNS requires `network_mode: host` on your Docker container. Standard bridge networking blocks mDNS broadcasts. Use manual pairing if you can't use host networking.
</details>

<details>
<summary><b>What if my server crashes during encoding?</b></summary>

BitBonsai's TRUE RESUME system automatically detects interrupted jobs and resumes from the exact timestamp. Zero manual intervention required.
</details>

---

## 🐛 Known Issues (Beta)

| Issue | Status | Workaround |
|-------|--------|------------|
| UI flicker on queue refresh | Investigating | Refresh page |
| AV1 encoding not yet available | In development | Use H.265 for now |
| Plex integration incomplete | In development | Manual library scan |

Report new issues: [GitHub Issues](https://github.com/lucid-fabrics/bitbonsai/issues)

---

## 🗺️ Roadmap

### Current (Beta)
- ✅ Core encoding (H.264 → H.265)
- ✅ Multi-node distribution
- ✅ Hardware acceleration
- ✅ TRUE RESUME & Auto-Heal
- ✅ Jellyfin integration

### Coming Soon
- 🔄 AV1 encoding support
- 🔄 Plex/Emby integration
- 🔄 Webhook notifications (Discord, Slack)
- 🔄 Scheduled encoding (off-peak hours)
- 🔄 Advanced analytics

### Future
- 📋 Mobile app
- 📋 Cloud storage support (S3, B2)
- 📋 Machine learning quality optimization

---

## 📞 Support & Feedback

### Beta Feedback
- **Issues:** [GitHub Issues](https://github.com/lucid-fabrics/bitbonsai/issues)
- **Discussions:** [GitHub Discussions](https://github.com/lucid-fabrics/bitbonsai/discussions)

### Community
- **Discord:** Coming soon

---

## 📄 License

BitBonsai is proprietary software. During beta, it's free for personal use.

Commercial licensing options coming after v1.0 release.

---

<div align="center">

**Built with ❤️ for the self-hosted community**

[Docker Hub](https://hub.docker.com/r/lucidfabrics/bitbonsai) • [GitHub](https://github.com/lucid-fabrics/bitbonsai) • [Report Issues](https://github.com/lucid-fabrics/bitbonsai/issues)

⭐ **Star this repo if BitBonsai helps you!** ⭐

</div>
