# BitBonsai Deployment Guide

> **On-Premise Video Transcoding Platform**
> Automatic HEVC/AV1 conversion with multi-node distribution

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (Single Node)](#quick-start-single-node)
- [Environment Configuration](#environment-configuration)
- [Multi-Node Setup](#multi-node-setup)
- [Security Checklist](#security-checklist)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Component | Minimum Version | Recommended |
|-----------|----------------|-------------|
| **Docker** | 24+ | 27+ |
| **PostgreSQL** | 14+ | 16+ |
| **Node.js** | 20+ | 22+ LTS |
| **FFmpeg** | 5.0+ | 7+ |
| **OS** | Ubuntu 22.04, Debian 12 | Ubuntu 24.04 LTS |

**Hardware Requirements:**

| Node Type | CPU | RAM | Storage |
|-----------|-----|-----|---------|
| **Main Node** | 4 cores | 8GB | 100GB+ SSD |
| **Worker Node** | 8+ cores | 16GB+ | NFS mount |

---

## Quick Start (Single Node)

### 1. Clone Repository

```bash
git clone https://github.com/yourusername/bitbonsai.git
cd bitbonsai
```

### 2. Configure Environment

```bash
# Copy template
cp .env.example .env

# Generate JWT secret
openssl rand -base64 32

# Edit .env and set:
# - JWT_SECRET (paste generated value)
# - DATABASE_URL (PostgreSQL connection)
# - ALLOWED_ORIGINS (your frontend URL)
```

### 3. Start Services

**Option A: Docker Compose (Recommended)**

```bash
docker-compose up -d
```

**Option B: Manual Build**

```bash
# Install dependencies
npm install

# Build backend
npm run build:backend

# Build frontend
npm run build:frontend

# Start backend
npm run start:backend

# Serve frontend (production)
npx http-server dist/apps/frontend -p 4210
```

### 4. Access Application

- **Frontend:** http://localhost:4210
- **API:** http://localhost:3100/api/v1
- **Health Check:** http://localhost:3100/api/v1/health

### 5. Initial Setup

1. Open frontend in browser
2. Navigate to **Settings → Setup**
3. Configure admin credentials
4. Add media directories to scan
5. Start encoding queue

---

## Environment Configuration

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | Secret for JWT tokens (**REQUIRED**) | `openssl rand -base64 32` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | `http://localhost:4200,http://192.168.1.100:4210` |
| `NODE_TYPE` | Node role: `MAIN` or `LINKED` | `MAIN` |
| `NODE_NAME` | Unique identifier for this node | `main-node` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Backend API port |
| `NODE_ENV` | `development` | Environment: `development` \| `production` |
| `JWT_EXPIRATION` | `7d` | Token validity period |
| `RATE_LIMIT_TTL` | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_LIMIT` | `1000` | Max requests per window |
| `LOG_LEVEL` | `info` | Log level: `error` \| `warn` \| `info` \| `debug` |

**Full reference:** See [.env.example](./.env.example)

---

## Multi-Node Setup

BitBonsai supports distributed transcoding across multiple nodes with shared NFS storage.

### Architecture

```
┌─────────────────────────────────────────────────┐
│ MAIN NODE (192.168.1.100)                       │
│ ┌─────────────┐  ┌──────────────┐              │
│ │ PostgreSQL  │  │ BitBonsai    │              │
│ │ Database    │◄─┤ Backend      │              │
│ └─────────────┘  │ (API)        │              │
│                  └──────────────┘              │
│                          ▲                       │
│                          │                       │
│                  ┌───────┴─────────┐             │
│                  │ NFS Server      │             │
│                  │ /mnt/media      │             │
│                  └───────┬─────────┘             │
└──────────────────────────┼───────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
┌─────────▼─────┐  ┌───────▼─────┐  ┌──────▼──────┐
│ WORKER NODE 1 │  │ WORKER NODE 2│  │ WORKER NODE 3│
│ (192.168.1.170)│ │ (192.168.1.171)│ │ (192.168.1.172)│
│ ┌───────────┐ │  │ ┌───────────┐│  │ ┌───────────┐│
│ │ BitBonsai │ │  │ │ BitBonsai ││  │ │ BitBonsai ││
│ │ Backend   │ │  │ │ Backend   ││  │ │ Backend   ││
│ │ (Worker)  │ │  │ │ (Worker)  ││  │ │ (Worker)  ││
│ └───────────┘ │  │ └───────────┘│  │ └───────────┘│
│               │  │               │  │               │
│ NFS Mount     │  │ NFS Mount     │  │ NFS Mount     │
│ /mnt/media    │  │ /mnt/media    │  │ /mnt/media    │
└───────────────┘  └───────────────┘  └───────────────┘
```

### 1. Setup MAIN Node

**Configure as MAIN:**

```bash
# .env on MAIN node
NODE_TYPE=MAIN
NODE_NAME=main-node
DATABASE_URL=postgresql://bitbonsai:password@localhost:5432/bitbonsai
JWT_SECRET=<your-generated-secret>
ALLOWED_ORIGINS=http://192.168.1.100:4210,http://192.168.1.170:4210
```

**Setup NFS export:**

```bash
# Install NFS server
sudo apt install nfs-kernel-server

# Configure exports
sudo nano /etc/exports

# Add line:
/mnt/media 192.168.1.0/24(rw,sync,no_subtree_check,no_root_squash)

# Apply
sudo exportfs -ra
sudo systemctl restart nfs-kernel-server
```

### 2. Setup LINKED Nodes (Workers)

**Mount NFS share:**

```bash
# Install NFS client
sudo apt install nfs-common

# Create mount point
sudo mkdir -p /mnt/media

# Mount NFS
sudo mount 192.168.1.100:/mnt/media /mnt/media

# Make permanent (add to /etc/fstab)
echo "192.168.1.100:/mnt/media /mnt/media nfs defaults 0 0" | sudo tee -a /etc/fstab
```

**Configure as LINKED:**

```bash
# .env on LINKED node
NODE_TYPE=LINKED
NODE_NAME=worker-1
MAIN_NODE_URL=http://192.168.1.100:3100
JWT_SECRET=<same-secret-as-main>
ALLOWED_ORIGINS=http://192.168.1.100:4210
```

### 3. Pairing Process

**Option A: Web UI (Recommended)**

1. Open MAIN node frontend: http://192.168.1.100:4210
2. Navigate to **Settings → Nodes**
3. Click **Pair New Node**
4. Enter LINKED node IP: `192.168.1.170`
5. Copy pairing token
6. On LINKED node, paste token in pairing endpoint

**Option B: API (Advanced)**

```bash
# On MAIN node, generate pairing token
curl -X POST http://192.168.1.100:3100/api/v1/nodes/pair/token \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"nodeName": "worker-1"}'

# Response: { "pairingToken": "abc123..." }

# On LINKED node, complete pairing
curl -X POST http://192.168.1.170:3100/api/v1/nodes/pair/complete \
  -H "Content-Type: application/json" \
  -d '{"pairingToken": "abc123..."}'
```

### 4. Verify Multi-Node Setup

```bash
# Check node status on MAIN
curl http://192.168.1.100:3100/api/v1/nodes

# Expected response:
# [
#   { "name": "main-node", "type": "MAIN", "status": "ACTIVE" },
#   { "name": "worker-1", "type": "LINKED", "status": "ACTIVE" },
#   { "name": "worker-2", "type": "LINKED", "status": "ACTIVE" }
# ]
```

---

## Security Checklist

### Pre-Deployment

- [ ] **JWT_SECRET** set to random 32+ character string
- [ ] **DATABASE_URL** uses strong password (20+ chars)
- [ ] **ALLOWED_ORIGINS** configured for your network (no wildcards)
- [ ] `.env` file has restricted permissions: `chmod 600 .env`
- [ ] `.env` excluded from git (already in `.gitignore`)
- [ ] Firewall rules configured (ports 3100, 4210, PostgreSQL)

### Production Environment

- [ ] `NODE_ENV=production` set
- [ ] TLS/HTTPS enabled (via reverse proxy)
- [ ] Rate limiting configured
- [ ] Security headers enabled (Helmet)
- [ ] Database backups automated
- [ ] Log rotation configured
- [ ] Monitoring/alerting setup

### Network Security

- [ ] PostgreSQL not exposed to public internet
- [ ] NFS shares restricted to trusted subnet
- [ ] API accessible only via reverse proxy (Nginx/Traefik)
- [ ] Frontend served over HTTPS in production

### Secret Management

**Development:**
- Generate unique values using `openssl rand -base64 32`
- Never use production secrets in development

**Production:**
- Use secret management service (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault)
- Enable secret rotation (JWT: 90 days, DB: 90 days)
- Enable audit logging for secret access

---

## Troubleshooting

### Backend Won't Start

**Error:** `JWT_SECRET is required in production mode`

**Fix:**
```bash
# Generate and set JWT_SECRET
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
```

---

**Error:** `Connection refused to PostgreSQL`

**Fix:**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Verify connection string in .env
# Ensure DATABASE_URL uses correct host/port/credentials
```

---

**Error:** `CORS policy: No 'Access-Control-Allow-Origin' header`

**Fix:**
```bash
# Add frontend URL to ALLOWED_ORIGINS in .env
ALLOWED_ORIGINS=http://your-frontend-url:4210
```

---

### Worker Node Not Encoding

**Issue:** Jobs stuck in QUEUED state on LINKED node

**Diagnosis:**
```bash
# Check NFS mount
df -h | grep /mnt/media

# Test file access
touch /mnt/media/test.txt
rm /mnt/media/test.txt

# Check node pairing status
curl http://main-node-ip:3100/api/v1/nodes
```

**Fix:**
```bash
# Remount NFS if stale
sudo umount -f /mnt/media
sudo mount 192.168.1.100:/mnt/media /mnt/media

# Re-pair node if needed
# (see Pairing Process above)
```

---

### High Memory Usage

**Issue:** Backend consuming excessive RAM

**Diagnosis:**
```bash
# Check encoding jobs
curl http://localhost:3100/api/v1/queue/stats

# Check FFmpeg processes
ps aux | grep ffmpeg
```

**Fix:**
```bash
# Limit concurrent jobs per node
# Add to .env:
MAX_CONCURRENT_JOBS=2

# Restart backend
docker-compose restart backend
```

---

### Frontend Not Loading

**Error:** Blank page or "Cannot GET /api/v1/..."

**Fix:**
```bash
# Check backend is running
curl http://localhost:3100/api/v1/health

# Verify frontend environment
# apps/frontend/src/environments/environment.prod.ts should have:
# apiUrl: '/api/v1' (relative path for same-origin)

# Rebuild frontend
npm run build:frontend

# Serve with correct base href
npx http-server dist/apps/frontend -p 4210
```

---

## Advanced Topics

### Reverse Proxy Setup (Nginx)

```nginx
# /etc/nginx/sites-available/bitbonsai

upstream backend {
    server 127.0.0.1:3100;
}

server {
    listen 80;
    server_name bitbonsai.yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name bitbonsai.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/bitbonsai.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bitbonsai.yourdomain.com/privkey.pem;

    # Frontend
    location / {
        root /var/www/bitbonsai/frontend;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/v1/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Increase timeouts for long-running operations
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
```

### Docker Compose Production Example

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: bitbonsai
      POSTGRES_USER: bitbonsai
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    networks:
      - bitbonsai

  backend:
    build:
      context: .
      dockerfile: apps/backend/Dockerfile
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://bitbonsai:${DB_PASSWORD}@postgres:5432/bitbonsai
      JWT_SECRET: ${JWT_SECRET}
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS}
    volumes:
      - /mnt/media:/media:ro
    depends_on:
      - postgres
    restart: unless-stopped
    networks:
      - bitbonsai

  frontend:
    image: nginx:alpine
    volumes:
      - ./dist/apps/frontend:/usr/share/nginx/html:ro
    ports:
      - "4210:80"
    restart: unless-stopped
    networks:
      - bitbonsai

volumes:
  postgres_data:

networks:
  bitbonsai:
    driver: bridge
```

---

## Support

- **Documentation:** [README.md](./README.md)
- **Issues:** https://github.com/yourusername/bitbonsai/issues
- **Discussions:** https://github.com/yourusername/bitbonsai/discussions

---

**Last Updated:** 2026-01-14
**Version:** 1.0.0
