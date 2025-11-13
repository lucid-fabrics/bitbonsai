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
