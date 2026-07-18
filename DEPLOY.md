# BitBonsai - Deployment Quick Reference

Quick commands for deploying to different environments.

**Full guides:** See `docs/deployment/`

---

## Main Node (Unraid Docker)

Single all-in-one container (`bitbonsai`): embedded PostgreSQL, nginx +
backend on one port. Built from `Dockerfile.prod`'s `production` target,
not the split backend/frontend containers some older docs describe.

```bash
export FONTAWESOME_NPM_AUTH_TOKEN='...'  # needed to build the image
./scripts/deploy-unraid.sh
```

**Target:** 192.168.1.100
**Access:** http://192.168.1.100:8108
**Rollback:** the script health-checks the new container and automatically
rolls back to the previous one on failure; it also keeps the prior
container stopped as `bitbonsai-old` for one extra manual-rollback generation.
**Migrations:** applied automatically on container start by
`docker-entrypoint.sh` (`prisma migrate deploy`, falling back to
`db push --accept-data-loss`) - no separate migration step needed.

---

## Child Nodes

### LXC Container (Proxmox)

```bash
./scripts/deploy-child-lxc.sh
```

**Target:** Proxmox `pve-labg5` → LXC 300 (192.168.1.170)
**Method:** `pct exec` + rsync
**NFS:** 4 mounts (media, downloads, cache, previews)

### VM or Bare Metal

```bash
./scripts/deploy-child-vm.sh [IP] [USER] [PATH]
```

**Examples:**

```bash
# Default (192.168.1.170)
./scripts/deploy-child-vm.sh

# Custom target
./scripts/deploy-child-vm.sh 192.168.1.180 root /opt/bitbonsai
```

**Method:** Direct SSH + rsync
**NFS:** Manual (see output for next steps)

---

## Website & License API

### Website (Marketing)

```bash
./scripts/deploy-website.sh
```

**Target:** Static hosting (Netlify/Vercel)

### License API

```bash
./scripts/deploy-license-stack.sh
```

**Target:** Docker Compose stack
**Services:** PostgreSQL + NestJS API

---

## Utilities

### Update Child Node Locally

Run **ON the child node** after code sync:

```bash
ssh root@192.168.1.170
cd /opt/bitbonsai
./scripts/utils/update-local.sh
```

### Generate Releases

```bash
# Unraid release
./scripts/generate-unraid-release.sh

# Proxmox LXC release
./scripts/generate-proxmox-release.sh
```

---

## Development

### Serve Locally

```bash
# Backend API
nx serve backend           # http://localhost:3000

# Frontend UI
nx serve frontend          # http://localhost:4200

# Website
nx serve website           # http://localhost:4201

# License API
nx serve license-api       # http://localhost:3200
```

### Build for Production

```bash
nx build backend --configuration=production
nx build frontend --configuration=production
nx build website --configuration=production
```

---

## Troubleshooting

### Check Service Status

```bash
# Unraid (single all-in-one container)
ssh root@unraid 'docker logs -f bitbonsai'

# LXC Child
ssh pve-labg5 'pct exec 300 -- journalctl -u bitbonsai-backend -f'

# VM Child
ssh root@192.168.1.170 'systemctl status bitbonsai-backend'
```

### Verify Deployment

```bash
# Health check
curl http://192.168.1.100:8108/api/v1/health

# Node info
curl http://192.168.1.100:8108/api/v1/nodes/current
```

---

## Common Issues

**Issue:** "Cannot connect to backend"
**Fix:** Check proxy config in `proxy.conf.json` and `angular.json:76`

**Issue:** "NFS mounts missing on child"
**Fix:** See `docs/deployment/README.md` for NFS setup

**Issue:** "Prisma Client not generated"
**Fix:** `cd apps/backend && npx prisma generate`

---

**Last Updated:** 2026-07-18 (Main Node section verified against the live deployment; other sections not re-verified this pass)
**Full Documentation:** `docs/deployment/README.md`
