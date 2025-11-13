# BitBonsai CLI Reference

> **Complete Nx CLI command reference - All workflows use Nx only**

All commands use `npx nx <target>` format. No npm scripts are used (except `prepare` for Husky).

---

## Quick Start

```bash
npx nx dev                    # Start developing
npx nx test:all               # Run all tests
npx nx lint                   # Lint code
npx nx release:unraid:minor   # Create Unraid release
```

---

## Development

### Serve Applications

```bash
npx nx dev                    # Start frontend + backend (parallel)
npx nx serve frontend         # Frontend only (port 4210)
npx nx serve backend          # Backend only (port 3100)
```

### Code Quality

```bash
npx nx lint                   # Lint with Biome
npx nx format                 # Format with Biome
npx nx check                  # Check code quality
npx nx check:fix              # Auto-fix issues
```

### Build

```bash
npx nx build frontend --prod  # Production frontend
npx nx build backend --prod   # Production backend
npx nx run-many --target=build --all --prod  # Build all
npx nx reset                  # Clear Nx cache
```

---

## Testing

### Unit Tests

```bash
npx nx test:all               # All tests with coverage
npx nx test frontend          # Frontend tests
npx nx test backend           # Backend tests
npx nx test backend --watch   # Watch mode
npx nx test:coverage          # Coverage summary
```

### Integration Tests (Tiered)

```bash
# Individual levels
npx nx test:encoding:level1   # Basic encoding
npx nx test:encoding:level2   # Multi-codec
npx nx test:encoding:level3   # Concurrent
npx nx test:encoding:level4   # Edge cases
npx nx test:encoding:level5   # Auto-heal system
npx nx test:encoding:level8   # Quality verification

# All levels (sequential)
npx nx test:encoding:all      # Run all levels
```

### E2E Tests (Playwright)

```bash
npx nx test:e2e               # Headless
npx nx test:e2e:ui            # Interactive UI mode
npx nx test:e2e:debug         # Debug mode
npx nx test:e2e:headed        # Visible browser
npx nx test:e2e:chromium      # Chromium only
npx nx test:e2e:firefox       # Firefox only
npx nx test:e2e:webkit        # WebKit only
npx nx test:e2e:report        # Show report
```

---

## Database (Prisma)

```bash
npx nx prisma:generate        # Generate Prisma Client
npx nx prisma:migrate         # Run migrations (dev)
npx nx prisma:migrate:deploy  # Run migrations (prod)
npx nx prisma:studio          # Database GUI (port 5555)
npx nx prisma:seed            # Seed test data
```

---

## Docker

### Development

```bash
npx nx docker:dev             # Start dev environment
npx nx docker:dev:down        # Stop dev environment
```

### Production

```bash
npx nx docker:build           # Build image
npx nx docker:push            # Push to Docker Hub
npx nx docker:build-push      # Build + push
```

---

## Versioning

### Bump Version (No Git)

```bash
npx nx version:patch          # 1.0.0 → 1.0.1
npx nx version:minor          # 1.0.0 → 1.1.0
npx nx version:major          # 1.0.0 → 2.0.0
```

### Bump + Commit + Push

```bash
npx nx version:patch:commit   # Patch + commit + push + tag
npx nx version:minor:commit   # Minor + commit + push + tag
npx nx version:major:commit   # Major + commit + push + tag
```

---

## Unraid Release

### Generate Release Package

```bash
npx nx unraid:release         # Use current version
```

### Bump + Generate

```bash
npx nx release:unraid         # Patch + generate
npx nx release:unraid:minor   # Minor + generate
npx nx release:unraid:major   # Major + generate
```

**Output:** `unraid-release/` directory with 6 files
- `bitbonsai.xml` - Unraid template
- `docker-compose.production.yml`
- `README-UNRAID.md`
- `INSTALL.md`
- `CHANGELOG.md`
- `RELEASE_NOTES.txt`

---

## Environment

```bash
npx nx update:version         # Sync version to environment files
npx nx env:reset              # Reset test environment
npx nx env:reset:repopulate   # Reset + repopulate media
```

---

## Common Workflows

### Start Development

```bash
# Fresh start
npx nx prisma:generate        # Generate Prisma Client
npx nx prisma:migrate         # Run migrations
npx nx dev                    # Start servers
```

### Run Tests Before Commit

```bash
npx nx check:fix              # Auto-fix linting
npx nx test:all               # Run all tests
npx nx test:e2e               # Run E2E tests
```

### Create Unraid Release

```bash
# Complete release workflow
npx nx release:unraid:minor   # Bump minor + generate

# Then build Docker image
npx nx docker:build-push      # Build + push

# Create GitHub release
gh release create v$(node -p "require('./package.json').version") \
  --title "v$(node -p "require('./package.json').version") - Unraid Release" \
  --notes-file unraid-release/CHANGELOG.md
```

### Deploy to Production

```bash
# Build everything
npx nx run-many --target=build --all --prod

# Build Docker image
npx nx docker:build

# Push to registry
npx nx docker:push
```

---

## List Available Commands

```bash
# See all project targets
cat project.json | jq '.targets | keys'

# Or use Nx to show project
npx nx show project bitbonsai
```

---

## Target Descriptions

All targets include descriptions visible via:

```bash
cat project.json | jq '.targets.dev.description'
# Output: "Start frontend and backend development servers in parallel"
```

---

## Tips

### Parallel Execution

Nx runs independent tasks in parallel automatically:

```bash
# Builds frontend and backend in parallel
npx nx run-many --target=build --all
```

### Caching

Nx caches task results for speed:

```bash
# Clear cache if needed
npx nx reset

# Skip cache for fresh build
npx nx build frontend --skip-nx-cache
```

### Task Graph

Visualize task dependencies:

```bash
npx nx graph
```

### Watch Multiple Projects

```bash
# Terminal 1
npx nx serve frontend

# Terminal 2
npx nx serve backend

# Or use dev target for parallel
npx nx dev
```

---

## Environment Variables

All Nx targets respect environment variables:

```bash
# Development
NODE_ENV=development npx nx serve backend

# Production
NODE_ENV=production npx nx build backend --prod
```

---

## Troubleshooting

### Target Not Found

```bash
# List all targets
cat project.json | jq '.targets | keys'

# Check target exists
npx nx show project bitbonsai | grep "target-name"
```

### Command Fails

```bash
# Run with verbose output
npx nx <target> --verbose

# Check Nx version
npx nx --version
```

### Clear Everything

```bash
# Clear Nx cache
npx nx reset

# Clean node_modules
rm -rf node_modules package-lock.json
npm install

# Regenerate Prisma Client
npx nx prisma:generate
```

---

## Migration from npm scripts

**Before (npm):**
```bash
npm run test
npm run docker:build
npm run version:patch
```

**After (Nx):**
```bash
npx nx test:all
npx nx docker:build
npx nx version:patch
```

**Benefits:**
- Consistent CLI interface
- Better caching
- Parallel execution
- Task graph visualization
- Incremental builds

---

## Help

```bash
# Nx help
npx nx help

# Target-specific help
npx nx run help <target>

# List available targets
npx nx show project bitbonsai
```

---

## Documentation

- **Deployment:** `docs/development/deployment.md`
- **Architecture:** `docs/development/architecture.md`
- **Unraid Release:** `docs/releases/unraid.md`

---

<div align="center">

**All workflows powered by Nx**

[Docs](../docs/README.md) • [project.json](../project.json) • [Nx Documentation](https://nx.dev)

</div>
