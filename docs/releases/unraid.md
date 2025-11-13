# Unraid Community Apps Release Guide

This guide covers how to create and publish BitBonsai releases for the Unraid Community Applications store.

## Quick Commands

### Generate Release Package Only
```bash
nx unraid:release
```
Generates all Unraid release files using the current version from `package.json`.

### Bump Version and Generate Release

**Patch Release** (Bug fixes: 1.0.0 → 1.0.1)
```bash
nx release:unraid
```

**Minor Release** (New features: 1.0.0 → 1.1.0)
```bash
nx release:unraid:minor
```

**Major Release** (Breaking changes: 1.0.0 → 2.0.0)
```bash
nx release:unraid:major
```

### Manual Version Bumping
```bash
nx version:patch   # 1.0.0 → 1.0.1
nx version:minor   # 1.0.0 → 1.1.0
nx version:major   # 1.0.0 → 2.0.0
```

## Semantic Versioning

BitBonsai follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes, API incompatibility
- **MINOR** (1.X.0): New features, backward compatible
- **PATCH** (1.0.X): Bug fixes, backward compatible

The version is stored in `package.json` and automatically used by all release tools.

## Complete Release Workflow

### 1. Prepare Release
```bash
# Make sure all changes are committed
git status

# Bump version and generate release package
nx release:unraid:minor  # or patch/major
```

This will:
- Update `package.json` version (1.0.0 → 1.1.0)
- Generate all files in `unraid-release/` directory

### 2. Review Generated Files
```bash
ls -lah unraid-release/
```

Files generated:
- `bitbonsai.xml` - Unraid template (for Community Apps)
- `docker-compose.production.yml` - Production deployment
- `README-UNRAID.md` - User guide
- `INSTALL.md` - Installation instructions
- `CHANGELOG.md` - Version history
- `RELEASE_NOTES.txt` - Release checklist

### 3. Build and Push Docker Image
```bash
# Get current version
VERSION=$(node -p "require('./package.json').version")

# Build Docker image
docker build -t lucidfabrics/bitbonsai:$VERSION .

# Tag as latest
docker tag lucidfabrics/bitbonsai:$VERSION lucidfabrics/bitbonsai:latest

# Push to Docker Hub
docker push lucidfabrics/bitbonsai:$VERSION
docker push lucidfabrics/bitbonsai:latest
```

### 4. Commit and Create GitHub Release
```bash
# Commit version bump and release files
git add package.json unraid-release/
git commit -m "chore(release): v$VERSION - Unraid Community Apps release"
git push

# Create GitHub release
gh release create v$VERSION \
  --title "v$VERSION - Unraid Community Apps Release" \
  --notes-file unraid-release/CHANGELOG.md \
  --latest
```

### 5. Submit to Community Applications

**First Time Submission:**
1. Fork the [Community Applications repository](https://github.com/Squidly271/docker-templates)
2. Add `unraid-release/bitbonsai.xml` to appropriate category folder
3. Submit pull request

**Updates:**
Template updates automatically via GitHub URL:
```
https://raw.githubusercontent.com/lucid-fabrics/bitbonsai/main/unraid-release/bitbonsai.xml
```

## Generated Files Explained

### bitbonsai.xml
Unraid template defining:
- Container configuration
- Port mappings (4210, 3100)
- Volume paths (media, cache pool)
- Environment variables
- GPU passthrough options
- WebUI URL

### docker-compose.production.yml
Production-ready compose file with:
- Host networking (mDNS discovery)
- Cache pool SSD optimization
- Media library mappings
- Security settings
- GPU configuration examples

### Documentation Files
- **README-UNRAID.md**: Quick start, performance tips, troubleshooting
- **INSTALL.md**: Step-by-step installation guide
- **CHANGELOG.md**: Version history and changes
- **RELEASE_NOTES.txt**: Submission checklist and testing requirements

## Cache Pool Configuration

All releases include optimized SSD cache pool support:

**In Template:**
```xml
<Config Name="Encoding Cache (SSD)"
        Target="/cache"
        Default="/mnt/cache/bitbonsai-temp"
        Mode="rw"
        Description="STRONGLY RECOMMENDED for 10-100x faster encoding"
        Type="Path" />
```

**In Docker Compose:**
```yaml
volumes:
  - /mnt/cache/bitbonsai-temp:/cache:rw
environment:
  - ENCODING_TEMP_PATH=/cache
```

## Testing Before Release

1. **Install from generated template locally**
   ```bash
   # Copy XML to Unraid
   scp unraid-release/bitbonsai.xml root@unraid:/boot/config/plugins/dockerMan/templates-user/
   ```

2. **Verify all paths mount correctly**
   - Media library accessible
   - Cache pool working
   - App data persists

3. **Test encoding with cache pool**
   - Start encoding job
   - Verify temp file in `/mnt/cache/bitbonsai-temp/`
   - Confirm 10-100x performance improvement

4. **Test GPU passthrough** (if applicable)
   ```bash
   docker exec bitbonsai nvidia-smi  # NVIDIA
   docker exec bitbonsai ls -la /dev/dri  # Intel/AMD
   ```

5. **Verify auto-healing and resume**
   - Restart container during encoding
   - Confirm job resumes from checkpoint

## Troubleshooting

### Version Not Updating
```bash
# Manually update package.json
npm version patch --no-git-tag-version

# Then generate release
nx unraid:release
```

### Docker Build Fails
```bash
# Check Docker daemon
docker info

# Clean build cache
docker builder prune -a
```

### Template Validation
Use Unraid's template validator:
```bash
xmllint --noout unraid-release/bitbonsai.xml
```

## Release Checklist

- [ ] All code changes committed
- [ ] Tests passing
- [ ] Version bumped (patch/minor/major)
- [ ] Release package generated
- [ ] Docker image built and pushed
- [ ] GitHub release created
- [ ] Template tested on Unraid
- [ ] Cache pool performance verified
- [ ] GPU passthrough tested (if applicable)
- [ ] Documentation updated
- [ ] Community Apps submission (if first release)

## Support

- **GitHub Issues**: https://github.com/lucid-fabrics/bitbonsai/issues
- **Discussions**: https://github.com/lucid-fabrics/bitbonsai/discussions
- **Unraid Forum**: https://forums.unraid.net/
