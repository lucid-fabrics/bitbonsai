# BitBonsai Docker Setup Guide

Complete guide for running BitBonsai using Docker in development and production environments.

## Table of Contents

- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [Production Deployment](#production-deployment)
- [Environment Variables](#environment-variables)
- [Volume Management](#volume-management)
- [Service Configuration](#service-configuration)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

### Development Mode

```bash
# Start all services with hot-reload
docker-compose -f docker-compose.dev.yml up --build

# Access the application
# Frontend: http://localhost:4200
# Backend API: http://localhost:3000
# API Docs: http://localhost:3000/api
```

### Production Mode

```bash
# Build and start production services
docker-compose -f docker-compose.prod.yml up -d --build

# Access the application
# Frontend: http://localhost:4200
# Backend API: http://localhost:3000
# Nginx reverse proxy: http://localhost
```

---

## Development Setup

### Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 4GB+ available RAM
- 10GB+ available disk space

### Architecture

The development environment uses multi-stage Dockerfiles with separate containers for:

- **bitbonsai-backend**: NestJS API with hot-reload
- **bitbonsai-frontend**: Angular dev server with HMR
- **postgres** (optional): PostgreSQL database
- **redis** (optional): Redis for job queues

### Starting Development Environment

```bash
# Start all services
docker-compose -f docker-compose.dev.yml up

# Start in detached mode
docker-compose -f docker-compose.dev.yml up -d

# Build and start
docker-compose -f docker-compose.dev.yml up --build

# Start specific service
docker-compose -f docker-compose.dev.yml up bitbonsai-backend
```

### Development Workflow

1. **Edit code locally** - Changes sync via volume mounts
2. **Hot-reload automatically** - Both frontend and backend watch for changes
3. **Debug with breakpoints** - Backend debugger exposed on port 9229
4. **View logs** - `docker-compose logs -f [service-name]`

### Using Optional Services

#### PostgreSQL Database

Uncomment the PostgreSQL service in `docker-compose.dev.yml`:

```yaml
postgres:
  image: postgres:16-alpine
  environment:
    - POSTGRES_DB=bitbonsai
    - POSTGRES_USER=bitbonsai
    - POSTGRES_PASSWORD=bitbonsai_secure_password
```

Update backend `DATABASE_URL`:
```
DATABASE_URL=postgresql://bitbonsai:bitbonsai_secure_password@postgres:5432/bitbonsai
```

#### Redis for Job Queues

Uncomment the Redis service in `docker-compose.dev.yml`:

```yaml
redis:
  image: redis:7-alpine
```

Update backend environment:
```
REDIS_HOST=redis
REDIS_PORT=6379
```

### Debugging

#### Backend Debugging (VSCode)

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "attach",
  "name": "Docker: Attach to Backend",
  "remoteRoot": "/app",
  "localRoot": "${workspaceFolder}",
  "protocol": "inspector",
  "port": 9229,
  "restart": true,
  "skipFiles": ["<node_internals>/**"]
}
```

#### View Logs

```bash
# All services
docker-compose -f docker-compose.dev.yml logs -f

# Specific service
docker-compose -f docker-compose.dev.yml logs -f bitbonsai-backend

# Last 100 lines
docker-compose -f docker-compose.dev.yml logs --tail=100 bitbonsai-frontend
```

### Stopping Development Environment

```bash
# Stop all services (keep volumes)
docker-compose -f docker-compose.dev.yml down

# Stop and remove volumes
docker-compose -f docker-compose.dev.yml down -v

# Stop and remove images
docker-compose -f docker-compose.dev.yml down --rmi all
```

---

## Production Deployment

### Architecture

Production uses optimized builds:

- **Backend**: Node.js production runtime with built artifacts
- **Frontend**: Nginx serving static Angular build
- **Nginx**: Reverse proxy with rate limiting and HTTPS

### Production Build

```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Start production stack
docker-compose -f docker-compose.prod.yml up -d

# View status
docker-compose -f docker-compose.prod.yml ps
```

### Production Configuration

#### Environment File

Create `.env.production`:

```bash
# Database
DATABASE_URL=postgresql://user:password@postgres:5432/bitbonsai

# Media paths
MEDIA_PATHS=/media/TV,/media/Movies,/media/Anime

# Application
NODE_ENV=production
LOG_LEVEL=info
PORT=3000

# PostgreSQL (if using)
POSTGRES_DB=bitbonsai
POSTGRES_USER=bitbonsai
POSTGRES_PASSWORD=your_secure_password_here

# Redis (if using)
REDIS_PASSWORD=your_redis_password_here
```

Load environment file:

```bash
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d
```

#### Resource Limits

Services have configured resource limits in `docker-compose.prod.yml`:

- **Backend**: 2 CPU / 2GB RAM (limit), 0.5 CPU / 512MB (reservation)
- **Frontend**: 1 CPU / 512MB RAM (limit), 0.25 CPU / 128MB (reservation)
- **Nginx**: 0.5 CPU / 256MB RAM (limit), 0.1 CPU / 64MB (reservation)

Adjust as needed for your infrastructure.

### HTTPS/SSL Configuration

1. **Generate SSL certificates** (or use Let's Encrypt):

```bash
mkdir -p ssl
# Place cert.pem and key.pem in ssl directory
```

2. **Update nginx.conf** - Uncomment HTTPS server block

3. **Update docker-compose.prod.yml** - Ensure SSL volume is mounted

### Health Checks

All services include health checks:

```bash
# Check service health
docker inspect bitbonsai-backend | grep -A 10 Health

# View health status
docker-compose -f docker-compose.prod.yml ps
```

### Scaling Services

```bash
# Scale backend to 3 instances
docker-compose -f docker-compose.prod.yml up -d --scale bitbonsai-backend=3

# Scale with load balancer (requires nginx upstream configuration)
```

### Updates and Rollbacks

```bash
# Update to latest build
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d

# Rollback to specific version
docker-compose -f docker-compose.prod.yml down
docker tag bitbonsai:v1.0 bitbonsai:latest
docker-compose -f docker-compose.prod.yml up -d
```

---

## Environment Variables

### Backend Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode | `development` | Yes |
| `PORT` | Backend server port | `3000` | Yes |
| `DATABASE_URL` | Database connection string | `file:/data/bitbonsai.db` | Yes |
| `MEDIA_PATHS` | Comma-separated media folder paths | `/media` | Yes |
| `LOG_LEVEL` | Logging level | `info` | No |
| `REDIS_HOST` | Redis hostname | `redis` | No |
| `REDIS_PORT` | Redis port | `6379` | No |

### Frontend Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode | `development` | Yes |
| `API_URL` | Backend API URL | `http://bitbonsai-backend:3000` | No |

### Database Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `POSTGRES_DB` | Database name | `bitbonsai` | Yes |
| `POSTGRES_USER` | Database user | `bitbonsai` | Yes |
| `POSTGRES_PASSWORD` | Database password | - | Yes |

---

## Volume Management

### Development Volumes

```yaml
volumes:
  - ./apps/backend:/app/apps/backend:cached  # Source code sync
  - bitbonsai-data:/data                      # SQLite database
  - ./test-media:/media:ro                    # Test media (read-only)
```

### Production Volumes

```yaml
volumes:
  - bitbonsai-data:/data            # Application data
  - /path/to/media:/media:ro       # Production media (read-only)
  - postgres-data:/var/lib/postgresql/data  # PostgreSQL data
  - redis-data:/data               # Redis data
```

### Volume Operations

```bash
# List volumes
docker volume ls

# Inspect volume
docker volume inspect bitbonsai_bitbonsai-data

# Backup volume
docker run --rm -v bitbonsai_bitbonsai-data:/data -v $(pwd):/backup alpine tar czf /backup/data-backup.tar.gz /data

# Restore volume
docker run --rm -v bitbonsai_bitbonsai-data:/data -v $(pwd):/backup alpine tar xzf /backup/data-backup.tar.gz -C /

# Remove unused volumes
docker volume prune
```

---

## Service Configuration

### Port Mapping

| Service | Internal Port | External Port | Description |
|---------|---------------|---------------|-------------|
| bitbonsai-backend | 3000 | 3000 | Backend API |
| bitbonsai-backend | 9229 | 9229 | Node debugger (dev only) |
| bitbonsai-frontend | 4200 | 4200 | Angular dev server (dev) |
| bitbonsai-frontend | 80 | 4200 | Nginx server (prod) |
| nginx | 80 | 80 | HTTP reverse proxy |
| nginx | 443 | 443 | HTTPS reverse proxy |
| postgres | 5432 | 5432 | PostgreSQL |
| redis | 6379 | 6379 | Redis |

### Network Configuration

All services run on `bitbonsai-network` bridge network, allowing inter-service communication:

- Frontend → Backend: `http://bitbonsai-backend:3000`
- Backend → PostgreSQL: `postgresql://bitbonsai:password@postgres:5432/bitbonsai`
- Backend → Redis: `redis://redis:6379`

---

## Troubleshooting

### Common Issues

#### Issue: Container fails to start

```bash
# Check container logs
docker-compose -f docker-compose.dev.yml logs bitbonsai-backend

# Check container status
docker-compose -f docker-compose.dev.yml ps

# Restart container
docker-compose -f docker-compose.dev.yml restart bitbonsai-backend
```

#### Issue: Port already in use

```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port
docker-compose -f docker-compose.dev.yml up -p 3001:3000
```

#### Issue: Changes not reflecting (dev mode)

```bash
# Rebuild containers
docker-compose -f docker-compose.dev.yml up --build

# Clear volume and rebuild
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up --build
```

#### Issue: Out of disk space

```bash
# Remove unused containers, networks, images
docker system prune

# Remove all unused data including volumes
docker system prune -a --volumes

# Check disk usage
docker system df
```

#### Issue: Database connection errors

```bash
# Verify PostgreSQL is running
docker-compose -f docker-compose.prod.yml ps postgres

# Check PostgreSQL logs
docker-compose -f docker-compose.prod.yml logs postgres

# Test connection from backend
docker exec -it bitbonsai-backend sh
npm install -g pg
psql $DATABASE_URL
```

#### Issue: Permission denied errors

```bash
# Fix volume permissions
docker exec -it bitbonsai-backend sh
chown -R node:node /data

# Run as root temporarily (dev only)
docker-compose -f docker-compose.dev.yml run --user root bitbonsai-backend sh
```

### Performance Optimization

#### Enable BuildKit

```bash
# Enable Docker BuildKit for faster builds
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

docker-compose -f docker-compose.dev.yml build
```

#### Use Build Cache

```bash
# Build with cache
docker-compose -f docker-compose.prod.yml build

# Build without cache
docker-compose -f docker-compose.prod.yml build --no-cache
```

#### Optimize Volume Performance (macOS/Windows)

```yaml
# Use cached or delegated consistency modes
volumes:
  - ./apps/backend:/app/apps/backend:cached
  - ./apps/frontend:/app/apps/frontend:delegated
```

### Useful Commands

```bash
# Execute command in running container
docker exec -it bitbonsai-backend sh

# View container resource usage
docker stats

# Copy file from container
docker cp bitbonsai-backend:/data/bitbonsai.db ./backup.db

# Copy file to container
docker cp ./config.json bitbonsai-backend:/app/config.json

# Access PostgreSQL shell
docker exec -it bitbonsai-postgres psql -U bitbonsai -d bitbonsai

# Access Redis CLI
docker exec -it bitbonsai-redis redis-cli
```

---

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [Nx Docker Integration](https://nx.dev/recipes/docker)
- [NestJS Deployment](https://docs.nestjs.com/recipes/deployment)
- [Angular Deployment](https://angular.dev/tools/cli/deployment)

---

## Support

For issues or questions:
- Create an issue on GitHub
- Check existing documentation
- Review Docker logs for errors
