# 🎬 MediaInsight - Unraid Community Apps Template

## Installation on Unraid

### Method 1: Community Applications (Recommended - Coming Soon)
1. Open Unraid WebUI
2. Navigate to **Apps** tab
3. Search for **"MediaInsight"**
4. Click **Install**
5. Configure paths and ports
6. Click **Apply**

### Method 2: Manual Template Installation
1. Navigate to **Docker** tab in Unraid
2. Click **Add Container** at the bottom
3. Click **Template repositories**
4. Add this URL: `https://github.com/wassimmehanna/media-insight`
5. Select **MediaInsight** template
6. Configure and apply

### Method 3: Direct Docker Command
```bash
docker run -d \
  --name=media-insight \
  --restart=unless-stopped \
  -p 3000:3000 \
  -e TZ=America/New_York \
  -e NODE_ENV=production \
  -e API_PREFIX=api/v1 \
  -v /mnt/user/media:/media:ro \
  -v /mnt/user/Downloads:/downloads:ro \
  -v /mnt/user/appdata/media-insight:/app/data \
  lucidfabrics/media-insight:latest
```

## Configuration

### Required Settings
- **API Port**: `3000` - Port for Web UI and API access
- **Media Path**: `/mnt/user/media` - Your media library location (read-only recommended)

### Optional Settings
- **Downloads Path**: `/mnt/user/Downloads` - Your downloads folder (read-only)
- **App Data**: `/mnt/user/appdata/media-insight` - Scan results and config storage
- **Timezone**: `America/New_York` - Your timezone for scheduled scans
- **Node Environment**: `production` - Leave as default
- **API Prefix**: `api/v1` - Leave as default

## Accessing MediaInsight

After installation, access the web interface at:
```
http://[UNRAID-IP]:3000
```

Example: `http://192.168.1.100:3000`

## Recommended Unraid Setup

### Folder Structure
```
/mnt/user/
├── media/              # Your media library (mounted read-only)
│   ├── Movies/
│   ├── TV/
│   ├── Anime/
│   └── Anime Movies/
├── Downloads/          # Downloads folder (optional)
└── appdata/
    └── media-insight/  # App configuration and scan results
```

### Integration with Media Servers
MediaInsight works great alongside:
- **Plex** - Analyze your Plex library structure
- **Jellyfin** - Understand codec distribution
- **Emby** - Track storage usage
- **Sonarr/Radarr** - Verify media organization

### Performance Tips
1. **Read-Only Mounts**: Mount media folders as read-only (`:ro`) for safety
2. **Initial Scan**: First scan may take time depending on library size
3. **Scheduled Scans**: Configure auto-refresh interval in settings
4. **Resource Usage**: Minimal CPU/RAM usage during scans

## Updating MediaInsight

### Via Unraid Docker Manager
1. Navigate to **Docker** tab
2. Click **Check for Updates**
3. If update available, click **Update**
4. Container will restart automatically

### Via Docker Command
```bash
docker pull lucidfabrics/media-insight:latest
docker stop media-insight
docker rm media-insight
# Run installation command again
```

## Troubleshooting

### Cannot Access Web UI
- Verify port 3000 is not in use: `netstat -tuln | grep 3000`
- Check container logs: `docker logs media-insight`
- Ensure firewall allows port 3000

### Scan Not Working
- Verify media path is mounted correctly: `docker exec media-insight ls /media`
- Check folder permissions (container runs as user 99:100 by default)
- Review logs for errors: `docker logs media-insight`

### Empty Statistics
- Ensure media folders contain video files (.mp4, .mkv, .avi)
- Trigger manual scan via Web UI
- Check that ffprobe can access files

## Support

- **GitHub Issues**: https://github.com/lucidfabrics/media-insight/issues
- **Docker Hub**: https://hub.docker.com/r/lucidfabrics/media-insight

## Version History

- **0.1.0** (Initial Release)
  - Basic media scanning
  - Codec distribution analysis
  - Storage statistics
  - Angular 19 + NestJS architecture

---

**Made with ❤️ by Lucid Fabrics**
