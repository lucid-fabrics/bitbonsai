# BitBonsai Deployment Guide

> **Build, test, and deployment workflows for developers and DevOps**

This guide covers building, testing, and deploying BitBonsai across various environments.

---

## Table of Contents

- [Development Environment](#development-environment)
- [Build Process](#build-process)
- [Testing Strategy](#testing-strategy)
- [Docker Build & Deployment](#docker-build--deployment)
- [Unraid Release Process](#unraid-release-process)
- [Proxmox LXC Deployment](#proxmox-lxc-deployment)
- [CI/CD Pipeline](#cicd-pipeline)
- [Environment Configuration](#environment-configuration)
- [Monitoring & Logging](#monitoring--logging)

---

## Development Environment

### Prerequisites

```bash
# Check versions
node --version    # 20.x LTS required
npm --version     # 10.x+
docker --version  # 24.0+
```

### Local Setup

```bash
# Clone repository
git clone https://github.com/lucidfabrics/bitbonsai.git
cd bitbonsai

# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Start development servers
npx nx dev
```

**Services:**
- Frontend: http://localhost:4200 (HMR enabled)
- Backend: http://localhost:3100 (nodemon watch mode)
- Prisma Studio: `npx prisma studio` (http://localhost:5555)

### Hot Module Replacement (HMR)

Both frontend and backend support hot reload:

**Frontend (Angular):**
- Edit files in `apps/frontend/src/`
- Browser auto-refreshes on save
- State preserved across reloads

**Backend (NestJS):**
- Edit files in `apps/backend/src/`
- Server restarts on save (nodemon)
- ~2 second restart time

### Git Hooks (Husky)

Quality gates enforce code standards:

**Pre-commit:**
- Runs Biome linter
- Auto-fixes formatting issues
- Blocks commit if errors remain

**Pre-push:**
- Builds frontend + backend
- Runs all tests
- Runs Playwright E2E tests
- Blocks push if any failures

**Bypass (emergencies only):**
```bash
git commit --no-verify
git push --no-verify
```

---

## Build Process

### Nx Build System

BitBonsai uses **Nx** for monorepo management and incremental builds.

### Build Commands

**Frontend (Production):**
```bash
npx nx build frontend --prod

# Output: dist/apps/frontend/
# - index.html
# - main-{hash}.js
# - polyfills-{hash}.js
# - styles-{hash}.css
```

**Backend (Production):**
```bash
npx nx build backend --prod

# Output: dist/apps/backend/
# - main.js
# - assets/
```

**Build All:**
```bash
npx nx run-many --target=build --all --prod
```

### Optimizations

**Frontend:**
- Tree shaking (dead code elimination)
- Ahead-of-Time (AOT) compilation
- CSS minification
- Image optimization
- Lazy loading for routes

**Backend:**
- TypeScript compilation to ES2022
- Source maps for debugging
- Asset bundling (Prisma schema, .env template)

### Build Cache

Nx caches build artifacts for speed:

```bash
# Clear cache
npx nx reset

# Build without cache
npx nx build frontend --skip-nx-cache
```

### Version Management

**Semantic Versioning:**

```bash
# Patch release (1.0.0 → 1.0.1)
npx nx version:patch

# Minor release (1.0.0 → 1.1.0)
npx nx version:minor

# Major release (1.0.0 → 2.0.0)
npx nx version:major
```

**Auto-update environment files:**

```bash
# Syncs package.json version to apps/frontend/src/environments/
npm run update:version
```

---

## Testing Strategy

### Unit Tests (Jest)

**Run all tests:**
```bash
npm test
```

**Frontend tests:**
```bash
npx nx test frontend --coverage
```

**Backend tests:**
```bash
npx nx test backend --coverage
```

**Watch mode:**
```bash
npx nx test backend --watch
```

**Coverage requirements:**
- Minimum: 95% coverage
- Pre-push hook enforces this

### Integration Tests

**Encoding tests (tiered):**

```bash
# Level 1: Basic encoding
npm run test:encoding:level1

# Level 2: Multi-codec tests
npm run test:encoding:level2

# Level 3: Concurrent encoding
npm run test:encoding:level3

# Level 4: Edge cases
npm run test:encoding:level4

# Level 5: Auto-heal system
npm run test:encoding:level5

# Level 8: Quality verification
npm run test:encoding:level8

# Run all levels
npm run test:encoding:all-levels
```

**Each level tests:**
- FFmpeg command generation
- Progress tracking accuracy
- Error handling
- File verification
- Cleanup procedures

### E2E Tests (Playwright)

**Run E2E tests:**
```bash
# Headless
npm run test:e2e

# Headed (see browser)
npm run test:e2e:headed

# UI mode (interactive)
npm run test:e2e:ui

# Debug mode
npm run test:e2e:debug

# Specific browser
npm run test:e2e:chromium
npm run test:e2e:firefox
npm run test:e2e:webkit
```

**View reports:**
```bash
npm run test:e2e:report
```

**Test scenarios:**
- User authentication flow
- Library creation and scanning
- Policy configuration
- Job submission and monitoring
- Node pairing workflow
- Real-time WebSocket updates

---

## Docker Build & Deployment

### Multi-Stage Dockerfile

**Location:** `Dockerfile`

**Stages:**

1. **Builder** - Build frontend + backend
2. **Runtime** - Production runtime with FFmpeg

**Build Docker image:**

```bash
# Build with version tag
npm run docker:build

# Equivalent to:
docker build -f Dockerfile \
  -t lucidfabrics/bitbonsai:latest \
  -t lucidfabrics/bitbonsai:$(node -p "require('./package.json').version") \
  .
```

**Push to Docker Hub:**

```bash
npm run docker:push

# Or build + push:
npm run docker:build-push
```

### Docker Compose Environments

**Development:**
```bash
docker-compose -f docker-compose.dev.yml up --build
```

**Production:**
```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

**Unraid:**
```bash
docker-compose -f docker-compose.unraid.yml up -d --build
```

### Environment Variables

**Required in production:**

```bash
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@postgres:5432/bitbonsai
REDIS_HOST=redis
REDIS_PORT=6379
JWT_SECRET=your-secure-secret-here
```

**Optional:**

```bash
PORT=4210
API_PORT=3100
LOG_LEVEL=info
MAX_CONCURRENT_JOBS=2
ENCODING_TEMP_PATH=/cache
```

---

## Unraid Release Process

### Automated Release Generator

**Generate release package:**

```bash
# Uses version from package.json
npx nx unraid:release
```

**Bump version and generate:**

```bash
# Patch (1.0.0 → 1.0.1)
npx nx release:unraid

# Minor (1.0.0 → 1.1.0)
npx nx release:unraid:minor

# Major (1.0.0 → 2.0.0)
npx nx release:unraid:major
```

**Generated files** (in `unraid-release/`):

1. `bitbonsai.xml` - Unraid template for Community Apps
2. `docker-compose.production.yml` - Production Docker Compose
3. `README-UNRAID.md` - User guide
4. `INSTALL.md` - Installation instructions
5. `CHANGELOG.md` - Version history
6. `RELEASE_NOTES.txt` - Release checklist

### Complete Release Workflow

**1. Prepare release:**

```bash
# Ensure all changes committed
git status

# Bump version and generate release
npx nx release:unraid:minor  # or patch/major
```

**2. Build Docker image:**

```bash
VERSION=$(node -p "require('./package.json').version")

# Build
docker build -t lucidfabrics/bitbonsai:$VERSION .

# Tag as latest
docker tag lucidfabrics/bitbonsai:$VERSION lucidfabrics/bitbonsai:latest

# Push to Docker Hub
docker push lucidfabrics/bitbonsai:$VERSION
docker push lucidfabrics/bitbonsai:latest
```

**3. Create GitHub release:**

```bash
# Commit version bump
git add package.json unraid-release/
git commit -m "chore(release): v$VERSION - Unraid Community Apps release"
git push

# Create GitHub release
gh release create v$VERSION \
  --title "v$VERSION - Unraid Community Apps Release" \
  --notes-file unraid-release/CHANGELOG.md \
  --latest
```

**4. Test on Unraid:**

```bash
# Copy template to Unraid
scp unraid-release/bitbonsai.xml root@unraid:/boot/config/plugins/dockerMan/templates-user/

# Install from template via WebUI
# Verify:
# - Media paths mount correctly
# - Cache pool working
# - GPU passthrough (if applicable)
# - Encoding job completes successfully
```

**5. Submit to Community Apps:**

First time:
- Fork https://github.com/Squidly271/docker-templates
- Add `bitbonsai.xml` to appropriate category
- Submit pull request

Updates:
- Template auto-updates from GitHub URL
- No manual submission needed

**See:** [Unraid Release Guide](../releases/unraid.md) for full details.

---

## Proxmox LXC Deployment

### Automated Deployment Script

**Location:** `deploy-lxc/deploy-to-proxmox.sh`

**Usage:**

```bash
cd deploy-lxc

# Syntax:
./deploy-to-proxmox.sh <node> <ip> <ctid> <env>

# Examples:
./deploy-to-proxmox.sh pve-mirna 192.168.1.2 202 dev
./deploy-to-proxmox.sh pve-ai 192.168.1.5 203 prod
```

**What it does:**

1. **Create LXC container** (Ubuntu 24.04)
   - Configures networking (DHCP or static)
   - Allocates resources (4 CPU, 8GB RAM, 20GB disk)
   - Starts container

2. **Install dependencies**
   - Node.js 20.x LTS
   - FFmpeg 7.1+ (John Van Sickle static build)
   - PostgreSQL 16
   - System utilities (git, curl, build-essential)

3. **Deploy BitBonsai**
   - Syncs source code to `/opt/bitbonsai`
   - Installs npm dependencies
   - Generates Prisma Client
   - Runs database migrations
   - Builds frontend + backend

4. **Start services**
   - Backend API on port 3100
   - Frontend on port 4210
   - PostgreSQL database
   - Sets up systemd services (optional)

**Update existing deployment:**

```bash
# Update code and restart services
./deploy-to-proxmox.sh pve-mirna 192.168.1.2 202 dev update
```

**Configuration:**

Edit `deploy-lxc/config.sh`:

```bash
# LXC resources
LXC_CORES=4
LXC_MEMORY=8192
LXC_SWAP=2048
LXC_DISK_SIZE=20

# Network
LXC_BRIDGE=vmbr0
LXC_IP=dhcp  # or 192.168.1.100/24

# PostgreSQL
POSTGRES_PASSWORD=your_secure_password
```

---

## CI/CD Pipeline

### GitHub Actions (Future)

**Planned workflows:**

**1. Pull Request Checks** (`.github/workflows/pr.yml`):

```yaml
name: PR Checks
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: npm install
      - run: npx nx run-many --target=test --all --coverage
      - run: npx nx run-many --target=build --all --prod
      - run: npm run test:e2e
```

**2. Docker Build & Push** (`.github/workflows/docker.yml`):

```yaml
name: Docker Build
on:
  push:
    tags:
      - 'v*'
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: docker/setup-buildx-action@v2
      - uses: docker/login-action@v2
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}
      - uses: docker/build-push-action@v4
        with:
          push: true
          tags: |
            lucidfabrics/bitbonsai:latest
            lucidfabrics/bitbonsai:${{ github.ref_name }}
```

**3. Release Creation** (`.github/workflows/release.yml`):

```yaml
name: Create Release
on:
  push:
    tags:
      - 'v*'
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npx nx unraid:release
      - uses: softprops/action-gh-release@v1
        with:
          files: unraid-release/*
          body_path: unraid-release/CHANGELOG.md
```

---

## Environment Configuration

### Development (.env.development)

```bash
NODE_ENV=development
PORT=4210
API_PORT=3100
DATABASE_URL=file:./data/bitbonsai-dev.db
LOG_LEVEL=debug
MEDIA_PATHS=/path/to/test-media
```

### Production (.env.production)

```bash
NODE_ENV=production
PORT=4210
API_PORT=3100
DATABASE_URL=postgresql://bitbonsai:${POSTGRES_PASSWORD}@postgres:5432/bitbonsai
REDIS_HOST=redis
REDIS_PORT=6379
LOG_LEVEL=info
JWT_SECRET=${JWT_SECRET}
MEDIA_PATHS=/media/Movies,/media/TV,/media/Anime
ENCODING_TEMP_PATH=/cache
MAX_CONCURRENT_JOBS=2
```

### Environment-Specific Builds

**Frontend environments:**

```typescript
// apps/frontend/src/environments/environment.ts (dev)
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3100',
  wsUrl: 'ws://localhost:3100',
  version: '1.0.0'
};

// apps/frontend/src/environments/environment.prod.ts
export const environment = {
  production: true,
  apiUrl: 'http://bitbonsai-backend:3100',
  wsUrl: 'ws://bitbonsai-backend:3100',
  version: '1.0.0'
};
```

**Auto-update version:**

```bash
npm run update:version
# Reads package.json version, updates environment files
```

---

## Monitoring & Logging

### Logging Strategy

**Winston Logger (Backend):**

```typescript
// apps/backend/src/main.ts

app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

// Logs to:
// - Console (development)
// - File: logs/bitbonsai.log (production)
// - File: logs/error.log (errors only)
```

**Log Levels:**

```bash
LOG_LEVEL=debug   # Development
LOG_LEVEL=info    # Production
LOG_LEVEL=warn    # Production (less verbose)
LOG_LEVEL=error   # Production (errors only)
```

**Structured Logging:**

```typescript
this.logger.log('Job started', {
  jobId: job.id,
  filePath: job.filePath,
  targetCodec: job.targetCodec,
  nodeId: job.nodeId
});
```

### Health Checks

**Backend health endpoint:**

```bash
GET /api/health

Response:
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "disk": { "status": "up" }
  },
  "details": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "disk": {
      "status": "up",
      "freeSpace": "500GB",
      "totalSpace": "1TB"
    }
  }
}
```

**Docker health check:**

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3100/api/health || exit 1
```

### Performance Monitoring

**Metrics tracked:**

- Encoding jobs per hour
- Average encoding speed (FPS)
- Storage saved per day/week/month
- Node uptime and availability
- Active connections (WebSocket)
- Database query performance

**Future: Prometheus + Grafana**

```bash
# Expose metrics endpoint
GET /metrics

# Prometheus scrapes metrics
# Grafana visualizes dashboards
```

---

## Troubleshooting Deployments

### Build Failures

**Issue: Frontend build fails**

```bash
# Clear Nx cache
npx nx reset

# Clear node_modules
rm -rf node_modules package-lock.json
npm install

# Rebuild
npx nx build frontend --prod
```

**Issue: Backend build fails**

```bash
# Regenerate Prisma Client
npx prisma generate

# Check TypeScript errors
npx tsc --noEmit

# Rebuild
npx nx build backend --prod
```

### Docker Issues

**Issue: Docker build fails**

```bash
# Clear Docker cache
docker builder prune -a

# Build with no cache
docker build --no-cache -t lucidfabrics/bitbonsai:latest .
```

**Issue: Container won't start**

```bash
# Check logs
docker logs bitbonsai

# Inspect container
docker inspect bitbonsai

# Check health
docker exec bitbonsai curl http://localhost:3100/api/health
```

### LXC Deployment Issues

**Issue: Deployment script fails**

```bash
# Check SSH connectivity
ssh -i ~/.ssh/pve_ai_key root@192.168.1.2 'echo "Connected"'

# Check LXC exists
ssh -i ~/.ssh/pve_ai_key root@192.168.1.2 'pct list | grep 202'

# Manual deploy
cd deploy-lxc
./deploy-to-proxmox.sh pve-mirna 192.168.1.2 202 dev --debug
```

---

## Security Best Practices

### Secrets Management

**DO NOT commit secrets:**

- `.env` files excluded in `.gitignore`
- Use environment variables
- Use Docker secrets for production
- Rotate JWT secrets regularly

**Docker secrets:**

```yaml
services:
  bitbonsai:
    secrets:
      - postgres_password
      - jwt_secret

secrets:
  postgres_password:
    file: ./secrets/postgres_password.txt
  jwt_secret:
    file: ./secrets/jwt_secret.txt
```

### Production Hardening

**1. Use PostgreSQL (not SQLite)**
**2. Enable HTTPS (Nginx reverse proxy)**
**3. Restrict CORS origins**
**4. Enable rate limiting (Throttler)**
**5. Regular security updates**
**6. Backup database regularly**

---

## Next Steps

- **[Architecture Overview](./architecture.md)** - System design deep dive
- **[Feature Documentation](./features/)** - Feature implementation specs
- **[User Guides](../user/)** - End-user documentation

---

<div align="center">

**Ready to deploy BitBonsai to production!**

[Docs Home](../README.md) • [Architecture](./architecture.md) • [Unraid Release](../releases/unraid.md)

</div>
