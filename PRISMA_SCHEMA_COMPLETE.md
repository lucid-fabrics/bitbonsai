# BitBonsai Prisma Schema - Complete Implementation

## Overview

A complete, production-ready Prisma schema for BitBonsai has been designed and implemented. The schema follows SOLID principles, includes proper relationships, indexes, and comprehensive documentation.

## Files Created

### 1. `/prisma/schema.prisma` - Main Schema Definition
**Status**: ✅ Complete and Validated

**Contents**:
- 6 core models (License, Node, Library, Policy, Job, Metric)
- 9 enums for type safety
- 25+ indexes for optimal query performance
- Cascade delete rules properly configured
- SQLite default with PostgreSQL support

**Key Features**:
- **License-based access control**: FREE, PATREON, COMMERCIAL tiers
- **Multi-node architecture**: MAIN and LINKED node roles
- **Hardware acceleration**: CPU, Intel QSV, NVIDIA, AMD, Apple Silicon
- **Policy-based encoding**: Presets and custom FFmpeg settings
- **Job lifecycle tracking**: DETECTED → QUEUED → ENCODING → VERIFYING → COMPLETED/FAILED
- **Analytics ready**: Metric aggregation for insights dashboard

---

### 2. `/prisma/README.md` - Complete Documentation
**Status**: ✅ Complete

**Contents**:
- Detailed model descriptions
- Enum reference guide
- Relationship explanations
- Database indexes documentation
- Example queries (TypeScript/Prisma)
- JSON field schemas
- Security best practices
- Migration strategy
- Performance considerations

---

### 3. `/prisma/QUICK_START.md` - Developer Guide
**Status**: ✅ Complete

**Contents**:
- Initial setup instructions
- Daily development workflow
- Common operations (create, update, query)
- Troubleshooting guide
- Migration management
- Performance tips
- PostgreSQL migration guide
- Command reference

---

### 4. `/prisma/SCHEMA_DIAGRAM.md` - Visual Documentation
**Status**: ✅ Complete

**Contents**:
- ASCII Entity Relationship Diagram (ERD)
- Relationship summary
- Data flow diagram (8-stage process)
- Cascade delete behavior tree
- Index strategy explanation
- Common query patterns with SQL
- Data volume estimates (small/medium/large)
- JSON field examples
- Backup & recovery strategy

---

### 5. `/prisma/seed.ts` - Development Data
**Status**: ✅ Complete

**Contents**:
- Seeding script with sample data
- 3 licenses (FREE, PATREON, COMMERCIAL_PRO)
- 3 nodes (1 main + 2 workers)
- 3 libraries (Movies, TV, Anime)
- 3 policies (Balanced HEVC, Fast HEVC, Quality AV1)
- 6 jobs (various stages for testing)
- 10 metrics (system-wide + per-node)

**Usage**: `npm run prisma:seed`

---

### 6. `/prisma/types.ts` - TypeScript Type Definitions
**Status**: ✅ Complete

**Contents**:
- `LicenseFeatures` interface
- `DeviceProfiles` interface
- `AdvancedSettings` interface
- `CodecDistribution` interface
- Type guards for runtime validation
- Default values for each tier
- Helper functions:
  - `formatBytes()` - Human-readable file sizes
  - `formatDuration()` - Human-readable time
  - `getDominantCodec()` - Analytics helper
  - `mergeDeviceProfiles()` - Settings merger

---

### 7. `/prisma/.env.example` - Configuration Template
**Status**: ✅ Complete

**Contents**:
- SQLite configuration (default)
- PostgreSQL configuration (commented)
- Connection pooling options
- Prisma Studio settings

---

### 8. `package.json` - Scripts Configuration
**Status**: ✅ Updated

**New Scripts**:
```json
{
  "prisma:generate": "prisma generate",
  "prisma:migrate": "prisma migrate dev",
  "prisma:studio": "prisma studio",
  "prisma:seed": "ts-node prisma/seed.ts"
}
```

**Prisma Seed Configuration**:
```json
{
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  }
}
```

---

## Schema Overview

### Models

#### 1. License (Central Authority)
```typescript
- id, key (unique), tier, status
- maxNodes, maxConcurrentJobs
- features (JSON), validUntil
- stripeCustomerId, stripeSubscriptionId
Relations: → Nodes (1:N), Metrics (1:N)
```

#### 2. Node (Worker)
```typescript
- id, name, role, status, version
- acceleration, apiKey (unique)
- pairingToken (unique), lastHeartbeat
Relations: → License (N:1), Libraries (1:N), Jobs (1:N)
```

#### 3. Library (Storage)
```typescript
- id, name, path, mediaType
- enabled, lastScanAt
- totalFiles, totalSizeBytes
Relations: → Node (N:1), Policies (1:N), Jobs (1:N)
```

#### 4. Policy (Rules)
```typescript
- id, name, preset, targetCodec
- targetQuality, deviceProfiles (JSON)
- advancedSettings (JSON)
- atomicReplace, verifyOutput, skipSeeding
Relations: → Library (N:1), Jobs (1:N)
```

#### 5. Job (Work)
```typescript
- id, filePath, fileLabel
- sourceCodec, targetCodec, stage
- progress, etaSeconds
- beforeSizeBytes, afterSizeBytes, savedBytes
- startedAt, completedAt, error
Relations: → Node (N:1), Library (N:1), Policy (N:1)
```

#### 6. Metric (Analytics)
```typescript
- id, date
- jobsCompleted, jobsFailed
- totalSavedBytes, avgThroughputFilesPerHour
- codecDistribution (JSON)
Relations: → Node (N:1), License (N:1)
```

---

## Enums

```typescript
LicenseTier: FREE | PATREON | COMMERCIAL_STARTER | COMMERCIAL_PRO | COMMERCIAL_ENTERPRISE
LicenseStatus: ACTIVE | EXPIRED | REVOKED
NodeRole: MAIN | LINKED
NodeStatus: ONLINE | OFFLINE | ERROR
AccelerationType: CPU | INTEL_QSV | NVIDIA | AMD | APPLE_M
MediaType: MOVIE | TV_SHOW | MIXED | OTHER
PolicyPreset: BALANCED_HEVC | FAST_HEVC | QUALITY_AV1 | COPY_IF_COMPLIANT | CUSTOM
TargetCodec: HEVC | AV1 | VP9 | H264
JobStage: DETECTED | QUEUED | ENCODING | VERIFYING | COMPLETED | FAILED | CANCELLED
```

---

## Quick Start

### 1. Initial Setup
```bash
# Install dependencies (already done)
npm install

# Generate Prisma Client
npm run prisma:generate

# Create database and run migrations
npm run prisma:migrate

# Seed development data
npm run prisma:seed

# Open Prisma Studio (optional)
npm run prisma:studio
```

### 2. Use in NestJS
```typescript
// Create prisma.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}

// Inject into your services
constructor(private prisma: PrismaService) {}
```

### 3. Example Query
```typescript
// Get active jobs for a node
const jobs = await this.prisma.job.findMany({
  where: {
    nodeId: 'node_123',
    stage: { in: ['QUEUED', 'ENCODING'] }
  },
  include: {
    policy: true,
    library: true
  }
});
```

---

## Key Features

### 1. Flexible Licensing
- **FREE**: 1 node, 2 concurrent jobs
- **PATREON**: 2 nodes, 5 concurrent jobs, API access
- **COMMERCIAL_PRO**: 20 nodes, 50 concurrent jobs, all features

### 2. Hardware Acceleration Support
- CPU (universal compatibility)
- Intel Quick Sync Video (QSV)
- NVIDIA NVENC
- AMD VCE/AMF
- Apple Silicon Media Engine

### 3. Policy-Based Encoding
- Preset templates for common use cases
- Custom FFmpeg parameters
- Device compatibility profiles
- Safety features (atomic replace, verification)

### 4. Complete Job Lifecycle
```
DETECTED → QUEUED → ENCODING → VERIFYING → COMPLETED/FAILED
```

### 5. Analytics & Insights
- Daily metrics aggregation
- Per-node and system-wide statistics
- Codec distribution tracking
- Storage savings calculations

### 6. Multi-Node Architecture
- MAIN node (web UI, coordinator)
- LINKED nodes (workers)
- API key authentication
- Heartbeat health monitoring

---

## Database Options

### SQLite (Default)
- **Recommended for**: Single-node deployments, development
- **Advantages**: Zero configuration, file-based, production-ready
- **Configuration**: `DATABASE_URL="file:./prisma/bitbonsai.db"`

### PostgreSQL (Optional)
- **Recommended for**: Multi-node deployments, large scale
- **Advantages**: Better concurrency, advanced features
- **Configuration**: `DATABASE_URL="postgresql://user:pass@localhost:5432/bitbonsai"`
- **Migration**: Change `provider` in schema.prisma and regenerate

---

## Performance Optimizations

### Indexes Implemented
- **Primary lookups**: `license.key`, `node.apiKey`, `node.pairingToken`
- **Status filtering**: `license.status`, `node.status`, `job.stage`
- **Time-series**: `metric.date`, `job.completedAt`
- **Composite**: `job.[stage, nodeId]` for queue queries

### Query Patterns Optimized
- Get next job for node
- Node dashboard statistics
- Storage savings reports
- License usage checks
- Time-series analytics

---

## Security Considerations

### 1. Sensitive Data Protection
- `apiKey` and `pairingToken` should never be exposed in API responses
- Use `select` to explicitly omit sensitive fields

### 2. License Validation
- Always check `status === 'ACTIVE'` and `validUntil` before operations
- Enforce `maxNodes` and `maxConcurrentJobs` limits

### 3. Node Authentication
- Require valid `apiKey` for all node operations
- Update `lastHeartbeat` on every authenticated request
- Mark nodes `OFFLINE` if no heartbeat for 2+ minutes

### 4. Path Sanitization
- Validate all file paths to prevent directory traversal
- Use `path.resolve()` and verify paths are within allowed directories

---

## Next Steps

### Phase 1: Backend Integration (Immediate)
1. Create `PrismaService` in NestJS backend
2. Implement license validation endpoints
3. Implement node registration/heartbeat endpoints
4. Implement job queue management
5. Implement metrics aggregation

### Phase 2: Frontend Integration (Next)
1. Create TypeScript interfaces from Prisma types
2. Implement license management UI
3. Implement node management dashboard
4. Implement job queue visualization
5. Implement insights/analytics dashboard

### Phase 3: Advanced Features (Future)
1. Add webhook delivery tracking
2. Add quality analysis results
3. Add cloud storage sync status
4. Implement row-level security (PostgreSQL)
5. Add audit logging

---

## Testing

### Unit Tests
```typescript
// Example: Test license validation
describe('LicenseService', () => {
  it('should validate active license', async () => {
    const license = await prisma.license.findUnique({
      where: { key: 'test-key' }
    });
    expect(license.status).toBe('ACTIVE');
    expect(license.validUntil).toBeGreaterThan(new Date());
  });
});
```

### Integration Tests
```typescript
// Example: Test job lifecycle
describe('JobService', () => {
  it('should complete job and update metrics', async () => {
    const job = await createTestJob();
    await jobService.startEncoding(job.id);
    await jobService.completeJob(job.id, { savedBytes: 1000000 });

    const metric = await getMetricForToday();
    expect(metric.jobsCompleted).toBeGreaterThan(0);
  });
});
```

---

## Validation

### Schema Validation
```bash
npx prisma validate
# Output: The schema at prisma/schema.prisma is valid 🚀
```

### Type Safety
All models have TypeScript types auto-generated:
```typescript
import { License, Node, Job } from '@prisma/client';
// Fully typed with autocomplete!
```

---

## Documentation Index

1. **Schema Definition**: `/prisma/schema.prisma`
2. **Complete Guide**: `/prisma/README.md`
3. **Quick Start**: `/prisma/QUICK_START.md`
4. **Visual Diagram**: `/prisma/SCHEMA_DIAGRAM.md`
5. **Type Definitions**: `/prisma/types.ts`
6. **Seed Script**: `/prisma/seed.ts`
7. **Configuration**: `/prisma/.env.example`

---

## Summary

✅ **Complete Prisma schema designed and implemented**
✅ **6 models with proper relationships**
✅ **9 enums for type safety**
✅ **25+ performance indexes**
✅ **Comprehensive documentation (4 files)**
✅ **Type-safe TypeScript definitions**
✅ **Development seed data**
✅ **SQLite default with PostgreSQL support**
✅ **Schema validated successfully**

**Ready for**: Backend integration, frontend development, production deployment

---

## Resources

- **Prisma Docs**: https://www.prisma.io/docs
- **NestJS Prisma**: https://docs.nestjs.com/recipes/prisma
- **Schema Reference**: https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference
- **Client API**: https://www.prisma.io/docs/reference/api-reference/prisma-client-reference

---

**Status**: ✅ Complete and production-ready
**Last Updated**: October 1, 2025
**Version**: 1.0.0
