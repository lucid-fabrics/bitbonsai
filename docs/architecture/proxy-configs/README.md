# Angular Proxy Configurations

## Active Configuration

**`/proxy.conf.json`** (root) - Used by `ng serve` (see `angular.json:76`)

- **Target:** `http://localhost:3000` (development backend)
- **Timeout:** 600s (10 minutes)
- **Usage:** Default for all `nx serve` commands

## Environment Variants (Archived)

These configs are **NOT currently used** but preserved for reference:

| File | Target | Timeout | Purpose |
|------|--------|---------|---------|
| `proxy.local.conf.json` | localhost:3000 | None | Local development (no timeout) |
| `proxy.docker.conf.json` | 192.168.1.100:3100 | 600s | Docker environment |
| `proxy.unraid.conf.json` | 192.168.1.100:3100 | 30s | Unraid production |

## Switching Proxy Configs

To use a different proxy config:

```bash
# Temporary (one-time serve)
nx serve frontend --proxy-config=docs/architecture/proxy-configs/proxy.docker.conf.json

# Permanent (update angular.json)
# Edit angular.json line 76:
"proxyConfig": "docs/architecture/proxy-configs/proxy.docker.conf.json"
```

## When to Use Each

- **Development (localhost):** Use root `proxy.conf.json` (default)
- **Docker environment:** Use `proxy.docker.conf.json`
- **Unraid testing:** Use `proxy.unraid.conf.json`

## Creating New Configs

Copy `proxy.conf.json` and adjust:
- `target`: Backend URL
- `timeout`: Request timeout (ms)
- `secure`: true for HTTPS
- `logLevel`: "debug" | "info" | "warn" | "error"
