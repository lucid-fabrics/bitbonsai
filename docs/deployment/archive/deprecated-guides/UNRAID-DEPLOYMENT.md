# Unraid Community Applications Deployment Guide

This guide explains how to build and publish BitBonsai as a single-container app for Unraid's Community Applications store.

## Architecture

**Single Container** (Port 8108):
```
Container
├── nginx (port 8108) - Serves frontend + proxies /api
│   ├── / → Static Angular app
│   └── /api → proxy_pass to localhost:3000
└── Node.js backend (port 3000, internal only)
```

## Building the Docker Image

### 1. Build Production Image

```bash
# Build the all-in-one production image
docker build -f Dockerfile.prod --target production -t lucidfabrics/bitbonsai:latest .

# Tag with version
docker tag lucidfabrics/bitbonsai:latest lucidfabrics/bitbonsai:1.0.0
```

### 2. Test Locally

```bash
# Run the container
docker run -d \
  --name bitbonsai-test \
  -p 8108:8108 \
  -v ./data:/data \
  -v /mnt/user/media:/media \
  -v /mnt/cache/bitbonsai-temp:/cache \
  -e ADMIN_PASSWORD=$(openssl rand -base64 24) \
  -e JWT_SECRET=$(openssl rand -base64 32) \
  lucidfabrics/bitbonsai:latest

# Check logs
docker logs -f bitbonsai-test

# Test web UI
open http://localhost:8108

# Cleanup
docker stop bitbonsai-test && docker rm bitbonsai-test
```

### 3. Push to Docker Hub

```bash
# Login to Docker Hub
docker login

# Push latest tag
docker push lucidfabrics/bitbonsai:latest

# Push version tag
docker push lucidfabrics/bitbonsai:1.0.0
```

## Submitting to Unraid Community Applications

### 1. Fork the Community Applications Repository

```bash
git clone https://github.com/Squidly271/docker-templates.git
cd docker-templates
```

### 2. Add Your Template

Copy `unraid-release/bitbonsai.xml` to the appropriate category:

```bash
# Create your author folder if it doesn't exist
mkdir -p wassimmehanna

# Copy template
cp /path/to/bitbonsai/unraid-release/bitbonsai.xml wassimmehanna/

# Commit and push
git add wassimmehanna/bitbonsai.xml
git commit -m "Add BitBonsai - Intelligent Video Encoding Platform"
git push origin master
```

### 3. Create Pull Request

Submit a PR to [Squidly271/docker-templates](https://github.com/Squidly271/docker-templates) with:
- Clear description of what BitBonsai does
- Link to GitHub repository
- Screenshots of the web UI
- List of tested Unraid versions

## Template Features

The `bitbonsai.xml` template includes:

### Basic Configuration
- ✅ Single port (8108) for web UI
- ✅ Media library path mapping
- ✅ Downloads folder for *arr integration
- ✅ App data persistence
- ✅ SSD cache for encoding performance

### Authentication
- ✅ Admin password (required, masked)
- ✅ JWT secret (required, masked)

### Hardware Acceleration
- ✅ NVIDIA GPU (NVENC)
- ✅ Intel QuickSync (QSV)
- ✅ AMD GPU (AMF)

### Multi-Node Support
- ✅ Node role (MAIN/LINKED)
- ✅ Main node URL configuration
- ✅ Shared storage detection
- ✅ NFS export configuration

### Advanced Options
- ✅ Max concurrent jobs
- ✅ Nice level (CPU priority)
- ✅ Custom FFmpeg binary
- ✅ Preview screenshot toggle
- ✅ Database URL
- ✅ CORS origins
- ✅ Media paths

## Testing Checklist

Before publishing, verify:

- [ ] Container starts successfully
- [ ] Web UI loads at http://[IP]:8108
- [ ] Can login with admin credentials
- [ ] Can detect and encode test video
- [ ] Hardware acceleration works (if GPU available)
- [ ] Database persists after container restart
- [ ] Logs show no critical errors
- [ ] Multi-node pairing works (if testing)
- [ ] NFS auto-mounting works (if testing multi-node)

## Version Updates

When releasing new versions:

```bash
# Update version in package.json
npm version patch  # or minor, major

# Build with new version
docker build -f Dockerfile.prod --target production -t lucidfabrics/bitbonsai:X.Y.Z .
docker tag lucidfabrics/bitbonsai:X.Y.Z lucidfabrics/bitbonsai:latest

# Push both tags
docker push lucidfabrics/bitbonsai:X.Y.Z
docker push lucidfabrics/bitbonsai:latest
```

## Troubleshooting

### Container Won't Start

Check logs for missing environment variables:
```bash
docker logs bitbonsai
```

Common issues:
- Missing `ADMIN_PASSWORD` or `JWT_SECRET`
- Invalid path mappings
- Port 8108 already in use

### FFmpeg Not Found

The production image includes FFmpeg. If custom build needed:
```dockerfile
RUN apk add --no-cache ffmpeg ffprobe
```

### Permission Issues

Ensure PUID/PGID match your Unraid user:
```bash
# Check Unraid user
id nobody
# Should show uid=99(nobody) gid=100(users)
```

## Support

- **GitHub Issues**: https://github.com/wassimmehanna/bitbonsai/issues
- **Documentation**: See `deploy-lxc/MULTI-NODE-SETUP.md` for multi-node setup
- **Docker Hub**: https://hub.docker.com/r/lucidfabrics/bitbonsai

## License

MIT License - See LICENSE file for details
