# BitBonsai - Unraid Installation Guide

## Prerequisites

- Unraid 6.9.0 or newer
- Community Applications plugin installed
- (Optional) NVIDIA GPU with drivers installed
- (Optional) Intel CPU with QuickSync support
- (Recommended) Cache pool (SSD) for encoding performance

## Installation Steps

### 1. Install via Community Applications

1. Open Unraid WebUI
2. Navigate to **Apps** tab
3. Search for **"BitBonsai"**
4. Click **Install**
5. Configure settings (see below)
6. Click **Apply**

### 2. Configuration

#### Required Settings
- **WebUI Port**: 4210 (or any available port)
- **API Port**: 3100 (must remain 3100)
- **Media Library**: `/mnt/user/media` (your media location)
- **App Data**: `/mnt/user/appdata/bitbonsai`
- **Encoding Cache**: `/mnt/cache/bitbonsai-temp` ⚡ **CRITICAL for performance!**

#### Optional Settings
- **Downloads Folder**: `/mnt/user/Downloads`
- **PUID/PGID**: 99/100 (Unraid defaults)
- **Timezone**: Your local timezone
- **Max Concurrent Jobs**: 2 (adjust for your hardware)

#### Hardware Acceleration (Optional but Recommended)

**NVIDIA GPU:**
1. Extra Parameters: `--runtime=nvidia --gpus all`
2. NVIDIA_VISIBLE_DEVICES: `all`

**Intel QuickSync:**
1. Device: `/dev/dri` → `/dev/dri`

**AMD GPU:**
1. Device: `/dev/dri/renderD128` → `/dev/dri/renderD128`

### 3. Start Container

1. Click **Done** to close config
2. Wait for container to download and start
3. Check Docker tab to verify container is running

### 4. First Access

1. Navigate to `http://YOUR-SERVER-IP:4210`
2. Login with default credentials (set in template)
3. Change admin password immediately
4. Add your media libraries
5. Create encoding policies
6. Start encoding!

## Post-Installation

### Create Your First Library
1. Click **Libraries** → **Add Library**
2. Name: "Movies" (or your preference)
3. Path: Select `/media` or subdirectory
4. Save

### Create Encoding Policy
1. Click **Policies** → **Add Policy**
2. Name: "H.265 Balanced"
3. Source Codec: H.264
4. Target Codec: H.265 (HEVC)
5. Quality: Balanced
6. Enable GPU if available
7. Save

### Monitor Progress
1. Click **Queue** to see encoding jobs
2. View real-time progress, ETA, and stats
3. Check **History** for completed jobs

## Updating

1. Go to **Docker** tab
2. Click **Check for Updates**
3. If update available, click **Update**
4. Container will restart with new version

## Uninstallation

1. **Docker** tab → Stop container
2. Remove container
3. (Optional) Delete `/mnt/user/appdata/bitbonsai` to remove data
4. (Optional) Delete `/mnt/cache/bitbonsai-temp` to remove temp files

## Troubleshooting

See `README-UNRAID.md` for detailed troubleshooting steps.

## Support

- GitHub Issues: https://github.com/lucid-fabrics/bitbonsai/issues
- Unraid Forums: https://forums.unraid.net/
