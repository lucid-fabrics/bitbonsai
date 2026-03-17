#!/bin/bash

# BitBonsai - Unraid Community Applications Release Generator
# Generates all files needed for Unraid Community Apps store submission
# Usage: ./generate-unraid-release.sh [version]
#        If version not provided, reads from package.json

set -e  # Exit on error

# Configuration
# Read version from package.json if not provided as argument
if [ -z "$1" ]; then
  VERSION=$(node -p "require('./package.json').version")
  echo "📌 Using version from package.json: $VERSION"
else
  VERSION="$1"
  echo "📌 Using provided version: $VERSION"
fi

RELEASE_DIR="./unraid-release"
DOCKER_ORG="lucidfabrics"
DOCKER_IMAGE="bitbonsai"
GITHUB_REPO="lucid-fabrics/bitbonsai"

echo "🎨 BitBonsai - Unraid Community Apps Release Generator"
echo "========================================================"
echo "Version: $VERSION"
echo ""

# Step 1: Clean and create release directory
echo "📁 Step 1/7: Creating release directory..."
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR/icons"
mkdir -p "$RELEASE_DIR/docs"
echo "✅ Release directory created: $RELEASE_DIR"
echo ""

# Step 2: Generate updated XML template
echo "📝 Step 2/7: Generating Unraid XML template..."
cat > "$RELEASE_DIR/bitbonsai.xml" << 'XMLEOF'
<?xml version="1.0"?>
<Container version="2">
  <Name>BitBonsai</Name>
  <Repository>lucidfabrics/bitbonsai:latest</Repository>
  <Registry>https://hub.docker.com/r/lucidfabrics/bitbonsai</Registry>
  <Network>bridge</Network>
  <MyIP/>
  <Shell>sh</Shell>
  <Privileged>false</Privileged>
  <Support>https://github.com/lucid-fabrics/bitbonsai/issues</Support>
  <Project>https://github.com/lucid-fabrics/bitbonsai</Project>
  <Overview>
BitBonsai - Intelligent Video Encoding Platform

Automatically optimize your media library with smart encoding policies:
• Hardware acceleration (NVIDIA NVENC, Intel QSV, AMD AMF)
• Distributed encoding across multiple nodes
• Smart codec detection and conversion (H.264 → H.265/AV1)
• Resume capability for interrupted jobs
• Real-time progress tracking
• Auto-healing for failed jobs
• SSD cache pool support for faster encoding

Perfect for Plex/Jellyfin libraries - reduce storage by 40-60% while maintaining quality!
  </Overview>
  <Category>MediaApp:Video MediaServer:Video</Category>
  <WebUI>http://[IP]:[PORT:4210]/</WebUI>
  <TemplateURL>https://raw.githubusercontent.com/lucid-fabrics/bitbonsai/main/unraid-release/bitbonsai.xml</TemplateURL>
  <Icon>https://raw.githubusercontent.com/lucid-fabrics/bitbonsai/main/apps/frontend/src/assets/logo.png</Icon>
  <ExtraParams/>
  <PostArgs/>
  <CPUset/>
  <DateInstalled/>
  <DonateText/>
  <DonateLink/>
  <Requires/>

  <!-- Network Ports -->
  <Config Name="WebUI Port" Target="4200" Default="4210" Mode="tcp" Description="Web interface port (Frontend Angular app)" Type="Port" Display="always" Required="true" Mask="false">4210</Config>

  <Config Name="API Port" Target="3100" Default="3100" Mode="tcp" Description="Backend API port (required for frontend communication)" Type="Port" Display="always" Required="true" Mask="false">3100</Config>

  <!-- Storage Paths -->
  <Config Name="Media Library" Target="/media" Default="/mnt/user/media" Mode="rw" Description="Your media library (movies, TV shows) - BitBonsai will scan and encode videos here" Type="Path" Display="always" Required="true" Mask="false">/mnt/user/media</Config>

  <Config Name="Downloads Folder" Target="/downloads" Default="/mnt/user/Downloads" Mode="rw" Description="Downloads folder - BitBonsai can auto-process new downloads from Sonarr/Radarr" Type="Path" Display="always" Required="false" Mask="false">/mnt/user/Downloads</Config>

  <Config Name="App Data" Target="/data" Default="/mnt/user/appdata/bitbonsai" Mode="rw" Description="Database and configuration storage" Type="Path" Display="advanced" Required="true" Mask="false">/mnt/user/appdata/bitbonsai</Config>

  <Config Name="Encoding Cache (SSD)" Target="/cache" Default="/mnt/cache/bitbonsai-temp" Mode="rw" Description="Temporary encoding workspace - STRONGLY RECOMMENDED to use cache drive (SSD) for 10-100x faster encoding performance" Type="Path" Display="always" Required="true" Mask="false">/mnt/cache/bitbonsai-temp</Config>

  <!-- Environment Variables -->
  <Config Name="PUID" Target="PUID" Default="99" Mode="" Description="User ID for file permissions (99 = nobody on Unraid)" Type="Variable" Display="advanced" Required="false" Mask="false">99</Config>

  <Config Name="PGID" Target="PGID" Default="100" Mode="" Description="Group ID for file permissions (100 = users on Unraid)" Type="Variable" Display="advanced" Required="false" Mask="false">100</Config>

  <Config Name="TZ" Target="TZ" Default="America/New_York" Mode="" Description="Timezone for logging and scheduling" Type="Variable" Display="advanced" Required="false" Mask="false">America/New_York</Config>

  <Config Name="Log Level" Target="LOG_LEVEL" Default="info" Mode="" Description="Logging verbosity (debug, info, warn, error)" Type="Variable" Display="advanced" Required="false" Mask="false">info</Config>

  <Config Name="Max Concurrent Jobs" Target="MAX_CONCURRENT_JOBS" Default="2" Mode="" Description="Maximum number of encoding jobs to run simultaneously (adjust based on your CPU/GPU capacity)" Type="Variable" Display="advanced" Required="false" Mask="false">2</Config>

  <!-- Hardware Acceleration - NVIDIA GPU -->
  <Config Name="NVIDIA GPU (NVENC)" Target="NVIDIA_VISIBLE_DEVICES" Default="" Mode="" Description="Enable NVIDIA GPU passthrough for NVENC hardware encoding. Set to 'all' to use all GPUs, or specify GPU UUID. Requires '--runtime=nvidia' in Extra Parameters. Leave empty to disable." Type="Variable" Display="always" Required="false" Mask="false"/>

  <!-- Hardware Acceleration - Intel QuickSync -->
  <Config Name="Intel QuickSync (QSV)" Target="/dev/dri" Default="" Mode="rw" Description="Enable Intel QuickSync by passing /dev/dri device. Set to '/dev/dri' to enable. Leave empty to disable." Type="Device" Display="always" Required="false" Mask="false"/>

  <!-- Hardware Acceleration - AMD GPU -->
  <Config Name="AMD GPU (AMF)" Target="/dev/dri/renderD128" Default="" Mode="rw" Description="Enable AMD GPU by passing render device. Set to '/dev/dri/renderD128' to enable. Leave empty to disable." Type="Device" Display="always" Required="false" Mask="false"/>

  <!-- Extra Parameters -->
  <Config Name="Extra Parameters" Target="" Default="" Mode="" Description="Additional Docker parameters. For NVIDIA GPU add: --runtime=nvidia --gpus all" Type="Variable" Display="advanced" Required="false" Mask="false"/>
</Container>
XMLEOF

# Replace placeholders
sed -i.bak "s|VERSION_PLACEHOLDER|$VERSION|g" "$RELEASE_DIR/bitbonsai.xml"
rm "$RELEASE_DIR/bitbonsai.xml.bak" 2>/dev/null || true

echo "✅ XML template generated: $RELEASE_DIR/bitbonsai.xml"
echo ""

# Step 3: Generate production docker-compose
echo "🐳 Step 3/7: Generating production docker-compose.yml..."
cat > "$RELEASE_DIR/docker-compose.production.yml" << 'COMPOSEEOF'
version: '3.8'

services:
  bitbonsai:
    image: lucidfabrics/bitbonsai:latest
    container_name: bitbonsai
    restart: unless-stopped
    network_mode: host  # Required for mDNS node discovery
    environment:
      # Core Configuration
      - NODE_ENV=production
      - DATABASE_URL=file:/data/bitbonsai.db
      - PORT=3100

      # Media Paths (adjust to your setup)
      - MEDIA_PATHS=/media,/downloads

      # Performance
      - LOG_LEVEL=info
      - MAX_CONCURRENT_JOBS=2

      # Cache Pool (SSD for faster encoding)
      - ENCODING_TEMP_PATH=/cache

      # Security
      - ALLOWED_ORIGINS=http://localhost:4210,http://192.168.1.100:4210
      - JWT_SECRET=${JWT_SECRET:-change-me-in-production}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-change-me-in-production}

      # Permissions (Unraid defaults)
      - PUID=99
      - PGID=100
      - TZ=America/New_York
    volumes:
      # Media Library
      - /mnt/user/media:/media:rw
      - /mnt/user/Downloads:/downloads:rw

      # App Data
      - /mnt/user/appdata/bitbonsai:/data:rw

      # CRITICAL: Cache pool for temp files (SSD = 10-100x faster!)
      - /mnt/cache/bitbonsai-temp:/cache:rw
    # Uncomment for NVIDIA GPU support:
    # runtime: nvidia
    # environment:
    #   - NVIDIA_VISIBLE_DEVICES=all

    # Uncomment for Intel QuickSync support:
    # devices:
    #   - /dev/dri:/dev/dri

    # Uncomment for AMD GPU support:
    # devices:
    #   - /dev/dri/renderD128:/dev/dri/renderD128
    #   - /dev/dri/card0:/dev/dri/card0
COMPOSEEOF

echo "✅ Docker Compose generated: $RELEASE_DIR/docker-compose.production.yml"
echo ""

# Step 4: Generate Unraid-specific README
echo "📖 Step 4/7: Generating Unraid README..."
cat > "$RELEASE_DIR/README-UNRAID.md" << 'READMEEOF'
# BitBonsai for Unraid

Intelligent video encoding platform optimized for Unraid servers.

## Quick Start

### Method 1: Community Applications (Recommended)
1. Open Unraid WebUI → Apps
2. Search for "BitBonsai"
3. Click Install
4. Configure paths and GPU (if available)
5. Start the container
6. Access WebUI at `http://YOUR-SERVER-IP:4210`

### Method 2: Docker Compose
```bash
# Download production compose file
cd /mnt/user/appdata/bitbonsai
curl -O https://raw.githubusercontent.com/lucid-fabrics/bitbonsai/main/unraid-release/docker-compose.production.yml

# Edit configuration
nano docker-compose.production.yml

# Start services
docker-compose -f docker-compose.production.yml up -d
```

## ⚡ Performance Tips

### 1. Use Cache Pool for Encoding (CRITICAL!)
**ALWAYS** map `/cache` to `/mnt/cache/bitbonsai-temp` for 10-100x faster encoding:
- ✅ **WITH Cache Pool**: 4K video encodes in 30 minutes
- ❌ **WITHOUT Cache Pool**: Same video takes 5+ hours

Configure in template:
```
Container Path: /cache
Host Path: /mnt/cache/bitbonsai-temp
```

### 2. Hardware Acceleration
Enable GPU for 5-10x faster encoding:

**NVIDIA (NVENC)**
- Extra Parameters: `--runtime=nvidia --gpus all`
- Environment: `NVIDIA_VISIBLE_DEVICES=all`

**Intel QuickSync (QSV)**
- Device: `/dev/dri` → `/dev/dri`

**AMD (AMF)**
- Device: `/dev/dri/renderD128` → `/dev/dri/renderD128`

### 3. Concurrent Jobs
Adjust based on your hardware:
- CPU-only: 1-2 jobs
- With GPU: 2-4 jobs
- High-end GPU: 4-8 jobs

## 📁 Path Configuration

| Purpose | Container Path | Suggested Host Path |
|---------|---------------|---------------------|
| WebUI | Port 4210 | Any available port |
| API | Port 3100 | 3100 (required) |
| Media Library | /media | /mnt/user/media |
| Downloads | /downloads | /mnt/user/Downloads |
| App Data | /data | /mnt/user/appdata/bitbonsai |
| **Encoding Cache (SSD!)** | /cache | **/mnt/cache/bitbonsai-temp** |

## 🚀 First-Time Setup

1. **Access WebUI**: `http://YOUR-SERVER-IP:4210`
2. **Login**: Default admin password (change in template)
3. **Add Libraries**: Point to your media folders
4. **Create Policy**: Define encoding rules (H.264 → H.265, quality, etc.)
5. **Start Encoding**: BitBonsai will scan and queue files automatically

## 🔧 Troubleshooting

### Container won't start
```bash
# Check logs
docker logs bitbonsai

# Verify permissions
ls -la /mnt/user/appdata/bitbonsai
ls -la /mnt/cache/bitbonsai-temp
```

### WebUI not accessible
- Verify port 4210 and 3100 are not in use
- Check network mode is `host` (required for node discovery)

### Slow encoding
- ✅ Verify `/cache` is mapped to `/mnt/cache/` (SSD)
- ✅ Enable GPU acceleration
- ✅ Check `MAX_CONCURRENT_JOBS` isn't too high

### GPU not detected
```bash
# NVIDIA
docker exec bitbonsai nvidia-smi

# Intel/AMD
docker exec bitbonsai ls -la /dev/dri
```

## 📊 Features

- ✅ **Smart Codec Detection**: Automatically identifies files needing re-encoding
- ✅ **Hardware Acceleration**: NVIDIA NVENC, Intel QSV, AMD AMF support
- ✅ **Distributed Encoding**: Run multiple nodes across your network
- ✅ **Resume Capability**: Jobs resume from last checkpoint after crashes
- ✅ **Auto-Healing**: Failed jobs automatically retry with exponential backoff
- ✅ **SSD Cache Pool**: Blazing fast encoding with Unraid cache drives
- ✅ **Real-Time Monitoring**: Live progress, ETA, and statistics
- ✅ **Quality Presets**: Balanced, high quality, or maximum compression

## 🆘 Support

- **Issues**: https://github.com/lucid-fabrics/bitbonsai/issues
- **Discussions**: https://github.com/lucid-fabrics/bitbonsai/discussions
- **Unraid Forum**: https://forums.unraid.net/

## 📜 License

MIT License - See LICENSE file for details
READMEEOF

echo "✅ README generated: $RELEASE_DIR/README-UNRAID.md"
echo ""

# Step 5: Generate CHANGELOG
echo "📋 Step 5/7: Generating CHANGELOG..."
cat > "$RELEASE_DIR/CHANGELOG.md" << 'CHANGELOGEOF'
# BitBonsai Changelog

## [Unreleased]

### Added (Latest Features)
- ⚡ **Cache Pool Support**: SSD temp file storage for 10-100x faster encoding
- 🔄 **Auto-Healing**: Automatic job recovery with smart temp file detection
- ♻️ **Resume Capability**: Jobs resume from checkpoint after crashes/reboots
- 📊 **Enhanced Progress Tracking**: Real-time ETA, FPS, and size statistics
- 🎯 **Smart Retry Logic**: Exponential backoff for failed jobs
- 🔍 **Audit Trail**: Complete job history with healing decisions
- 🏥 **Health Monitoring**: Stuck job detection and recovery

### Changed
- Improved temp file persistence across container restarts
- Enhanced manual retry to preserve resume state
- Better logging for debugging and monitoring
- Optimized database queries with composite indexes

### Fixed
- Temp files now correctly preserved on manual retry
- Auto-healing properly detects and reports missing temp files
- Progress tracking accuracy improved for resumed jobs

## [Previous Releases]

See full changelog at: https://github.com/lucid-fabrics/bitbonsai/releases
CHANGELOGEOF

echo "✅ CHANGELOG generated: $RELEASE_DIR/CHANGELOG.md"
echo ""

# Step 6: Generate installation guide
echo "📝 Step 6/7: Generating installation guide..."
cat > "$RELEASE_DIR/INSTALL.md" << 'INSTALLEOF'
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
INSTALLEOF

echo "✅ Installation guide generated: $RELEASE_DIR/INSTALL.md"
echo ""

# Step 7: Generate release summary
echo "📦 Step 7/7: Generating release summary..."
cat > "$RELEASE_DIR/RELEASE_NOTES.txt" << NOTESEOF
BitBonsai - Unraid Community Applications Release
Version: $VERSION
Generated: $(date)

FILES INCLUDED:
================
1. bitbonsai.xml                    - Unraid template for Community Apps
2. docker-compose.production.yml    - Production Docker Compose file
3. README-UNRAID.md                 - Unraid-specific user guide
4. CHANGELOG.md                     - Version history and changes
5. INSTALL.md                       - Step-by-step installation guide
6. RELEASE_NOTES.txt                - This file

SUBMISSION CHECKLIST:
=====================
☐ Update version number in bitbonsai.xml
☐ Upload bitbonsai.xml to GitHub: /unraid-release/bitbonsai.xml
☐ Create GitHub release with tag: v$VERSION
☐ Upload icons to GitHub: /apps/frontend/src/assets/
☐ Submit template URL to Community Applications:
   https://raw.githubusercontent.com/$GITHUB_REPO/main/unraid-release/bitbonsai.xml
☐ Test installation on clean Unraid server
☐ Update forum thread with release notes

DOCKER IMAGE:
=============
Repository: $DOCKER_ORG/$DOCKER_IMAGE:latest
Tag (version): $DOCKER_ORG/$DOCKER_IMAGE:$VERSION

NEXT STEPS:
===========
1. Review all generated files in $RELEASE_DIR/
2. Update version numbers if needed
3. Build and push Docker image:
   docker build -t $DOCKER_ORG/$DOCKER_IMAGE:$VERSION .
   docker tag $DOCKER_ORG/$DOCKER_IMAGE:$VERSION $DOCKER_ORG/$DOCKER_IMAGE:latest
   docker push $DOCKER_ORG/$DOCKER_IMAGE:$VERSION
   docker push $DOCKER_ORG/$DOCKER_IMAGE:latest
4. Create GitHub release
5. Submit to Community Applications

TESTING:
========
Before submission, test on Unraid:
1. Install from template
2. Verify all paths mount correctly
3. Test WebUI accessibility
4. Test GPU passthrough (if applicable)
5. Verify cache pool performance improvement
6. Test encoding job submission and completion
7. Verify auto-healing and resume capabilities

NOTES:
======
- Cache pool support is CRITICAL for performance
- Network mode MUST be 'host' for mDNS discovery
- API port MUST remain 3100 for frontend communication
- Recommend SSD cache for /cache volume
NOTESEOF

echo "✅ Release notes generated: $RELEASE_DIR/RELEASE_NOTES.txt"
echo ""

# Display summary
echo "🎉 Release generation complete!"
echo ""
echo "📍 Output directory: $RELEASE_DIR/"
echo ""
echo "Generated files:"
ls -lh "$RELEASE_DIR/" | grep -v "^d" | awk '{print "  - " $9 " (" $5 ")"}'
echo ""
echo "Next steps:"
echo "  1. Review files in $RELEASE_DIR/"
echo "  2. Build Docker image: docker build -t $DOCKER_ORG/$DOCKER_IMAGE:$VERSION ."
echo "  3. Push to Docker Hub: docker push $DOCKER_ORG/$DOCKER_IMAGE:$VERSION"
echo "  4. Upload files to GitHub: cp -r $RELEASE_DIR/* ."
echo "  5. Create GitHub release: gh release create v$VERSION"
echo "  6. Submit XML to Unraid Community Apps"
echo ""
echo "Template URL for Community Apps:"
echo "  https://raw.githubusercontent.com/$GITHUB_REPO/main/unraid-release/bitbonsai.xml"
echo ""
