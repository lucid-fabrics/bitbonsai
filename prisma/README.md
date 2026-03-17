# BitBonsai Prisma Schema Documentation

## Overview

This schema defines the complete database structure for BitBonsai, a media optimization platform that manages encoding jobs across distributed nodes with license-based feature control.

## Core Models

### 1. License
**Purpose**: Manages subscription tiers and feature access control.

**Key Features**:
- Supports multiple tiers (FREE, PATREON, COMMERCIAL_*)
- Stripe integration for payment tracking
- Feature flags stored as JSON for flexible feature gating
- Can have unlimited or time-limited validity

**Relationships**:
- One-to-many with Nodes (one license can have multiple nodes up to maxNodes)
- One-to-many with Metrics (for license-level analytics)

**Important Fields**:
- `maxNodes`: Controls how many nodes can be activated
- `maxConcurrentJobs`: Controls parallel encoding capacity
- `features`: JSON object like `{ multiNode: true, advancedPresets: true, api: true }`
- `validUntil`: Null means perpetual/lifetime license

---

### 2. Node
**Purpose**: Represents a physical or virtual machine running the encoding worker.

**Key Features**:
- Supports MAIN (primary) and LINKED (worker) roles
- Hardware acceleration detection (CPU, Intel QSV, NVIDIA, AMD, Apple Silicon)
- Pairing token for secure node registration
- API key for authenticated communication
- Heartbeat tracking for health monitoring

**Relationships**:
- Belongs to one License
- Has many Libraries
- Processes many Jobs
- Generates Metrics

**Important Fields**:
- `pairingToken`: Temporary token during initial pairing (null after paired)
- `apiKey`: Permanent authentication key for node-to-node communication
- `lastHeartbeat`: Updated every 30-60 seconds by node
- `uptimeSeconds`: Total uptime for reliability metrics

---

### 3. Library
**Purpose**: Represents a media folder to be monitored and optimized.

**Key Features**:
- Supports different media types (Movies, TV Shows, Mixed, Other)
- Can be enabled/disabled without deletion
- Tracks total files and storage usage
- Records last scan timestamp

**Relationships**:
- Belongs to one Node
- Has many Policies (rules for how to encode media)
- Generates many Jobs

**Important Fields**:
- `path`: Absolute filesystem path
- `mediaType`: Helps with metadata detection and naming conventions
- `totalSizeBytes`: BigInt to support large libraries (>2TB)

**Unique Constraint**: Cannot have duplicate paths on the same node

---

### 4. Policy
**Purpose**: Defines encoding rules and parameters.

**Key Features**:
- Preset templates for common use cases
- Custom advanced FFmpeg settings
- Device compatibility profiles
- Safety features (atomic replace, verification)

**Relationships**:
- Can be associated with a Library (library-specific policy)
- Applied to many Jobs

**Important Fields**:
- `preset`: Quick templates (BALANCED_HEVC, FAST_HEVC, QUALITY_AV1, etc.)
- `targetQuality`: CRF value (0-51, lower = better quality)
- `deviceProfiles`: JSON like `{ appleTv: true, roku: true, web: true }`
- `advancedSettings`: JSON for custom FFmpeg flags
- `atomicReplace`: Ensures safe file replacement (rename, not overwrite)
- `skipSeeding`: Integrates with torrent clients to avoid disrupting active torrents

---

### 5. Job
**Purpose**: Represents a single file encoding task.

**Key Features**:
- Complete lifecycle tracking (DETECTED → QUEUED → ENCODING → VERIFYING → COMPLETED/FAILED)
- Real-time progress and ETA
- Storage savings calculation
- User-friendly file labels (hides full path complexity)

**Relationships**:
- Belongs to one Node (worker processing the job)
- Belongs to one Library (source location)
- Uses one Policy (encoding rules)

**Important Fields**:
- `filePath`: Full path for system operations
- `fileLabel`: Clean name for UI display (e.g., "The Matrix (1999).mkv")
- `progress`: 0.0 to 100.0 for UI progress bars
- `savedBytes`: Can be negative if encoded file is larger
- `savedPercent`: Calculated as `((beforeSize - afterSize) / beforeSize) * 100`

**Performance Indexes**:
- Composite index on `[stage, nodeId]` for efficient queue queries
- Index on `completedAt` for historical analytics

---

### 6. Metric
**Purpose**: Aggregated analytics for Insights dashboard.

**Key Features**:
- Time-bucketed data (daily aggregation)
- Node-specific or system-wide metrics
- Codec distribution tracking
- Throughput calculations

**Relationships**:
- Can belong to a Node (node-specific metrics)
- Can belong to a License (license-wide metrics)
- Both nullable for system-wide aggregation

**Important Fields**:
- `date`: Date bucket for time-series queries
- `codecDistribution`: JSON like `{ "H.264": 62, "HEVC": 34, "AV1": 4 }`
- `avgThroughputFilesPerHour`: Calculated from completed jobs

**Unique Constraint**: One metric row per date/node/license combination

---

## Enums Reference

### LicenseTier
```
FREE                    - Basic features, 1 node, 2 concurrent jobs
PATREON                 - Supporter tier, 2 nodes, 5 concurrent jobs
COMMERCIAL_STARTER      - Small business, 5 nodes, 10 concurrent jobs
COMMERCIAL_PRO          - Professional, 20 nodes, 50 concurrent jobs
COMMERCIAL_ENTERPRISE   - Unlimited nodes and jobs
```

### LicenseStatus
```
ACTIVE   - Currently valid and usable
EXPIRED  - Past validUntil date
REVOKED  - Manually disabled (refund, violation, etc.)
```

### NodeRole
```
MAIN    - Primary node (hosts web UI, coordinates work)
LINKED  - Worker node (receives jobs from MAIN)
```

### NodeStatus
```
ONLINE  - Active and responding to heartbeats
OFFLINE - No heartbeat in last 2 minutes
ERROR   - Encountered critical error
```

### AccelerationType
```
CPU        - Software encoding (slowest, most compatible)
INTEL_QSV  - Intel Quick Sync Video
NVIDIA     - NVIDIA NVENC
AMD        - AMD VCE/AMF
APPLE_M    - Apple Silicon Media Engine
```

### MediaType
```
MOVIE    - Movie library
TV_SHOW  - TV series library
MIXED    - Combined movies and TV
OTHER    - Music videos, home videos, etc.
```

### PolicyPreset
```
BALANCED_HEVC        - Good quality/speed balance, HEVC
FAST_HEVC            - Faster encoding, slightly lower quality
QUALITY_AV1          - Best compression, AV1 codec (slower)
COPY_IF_COMPLIANT    - Copy streams if already optimal
CUSTOM               - User-defined FFmpeg parameters
```

### TargetCodec
```
HEVC  - H.265 (best balance)
AV1   - AV1 (best compression, slower)
VP9   - VP9 (Google's codec)
H264  - H.264 (legacy compatibility)
```

### JobStage
```
DETECTED   - File detected, awaiting queue insertion
QUEUED     - In queue, waiting for available worker
ENCODING   - Currently being encoded
VERIFYING  - Checking output file integrity
COMPLETED  - Successfully finished
FAILED     - Encoding or verification failed
CANCELLED  - User-cancelled or policy skip
```

---

## Database Indexes

### Performance-Critical Indexes
```prisma
// License lookups
@@index([status])
@@index([tier])
@@index([email])

// Node health monitoring
@@index([status])
@@index([lastHeartbeat])

// Job queue optimization
@@index([stage, nodeId])  // Composite for "get next job for this node"
@@index([completedAt])    // Historical queries

// Metric time-series queries
@@index([date, nodeId])
```

---

## Database Setup

### Install Prisma
```bash
npm install prisma @prisma/client --save
```

### Generate Prisma Client
```bash
npx prisma generate
```

### Create Migration
```bash
npx prisma migrate dev --name init
```

### Push to Database (development)
```bash
npx prisma db push
```

### Studio (GUI)
```bash
npx prisma studio
```

---

## Example Queries

### Get Active Jobs for a Node
```typescript
const activeJobs = await prisma.job.findMany({
  where: {
    nodeId: 'node_abc123',
    stage: {
      in: ['QUEUED', 'ENCODING', 'VERIFYING']
    }
  },
  include: {
    policy: true,
    library: true
  },
  orderBy: {
    createdAt: 'asc'
  }
});
```

### Calculate Total Storage Savings
```typescript
const savings = await prisma.job.aggregate({
  where: {
    stage: 'COMPLETED',
    savedBytes: {
      gt: 0
    }
  },
  _sum: {
    savedBytes: true
  }
});
```

### Get License Usage
```typescript
const licenseUsage = await prisma.license.findUnique({
  where: { id: 'lic_xyz789' },
  include: {
    nodes: {
      where: {
        status: 'ONLINE'
      }
    },
    _count: {
      select: {
        nodes: true
      }
    }
  }
});

const canAddNode = licenseUsage._count.nodes < licenseUsage.maxNodes;
```

### Get Daily Metrics
```typescript
const dailyMetrics = await prisma.metric.findMany({
  where: {
    date: {
      gte: new Date('2025-09-01'),
      lte: new Date('2025-09-30')
    },
    nodeId: null  // System-wide metrics
  },
  orderBy: {
    date: 'asc'
  }
});
```

---

## JSON Field Schemas

### License.features
```typescript
interface LicenseFeatures {
  multiNode: boolean;          // Can link multiple nodes
  advancedPresets: boolean;    // Access to AV1 and custom presets
  api: boolean;                // REST API access
  priorityQueue: boolean;      // Priority job scheduling
  cloudStorage: boolean;       // S3/cloud upload support
  webhooks: boolean;           // Custom webhook notifications
}
```

### Policy.deviceProfiles
```typescript
interface DeviceProfiles {
  appleTv: boolean;      // Apple TV compatibility
  roku: boolean;         // Roku compatibility
  web: boolean;          // Web browser compatibility
  chromecast: boolean;   // Chromecast compatibility
  ps5: boolean;          // PlayStation 5 compatibility
  xbox: boolean;         // Xbox compatibility
}
```

### Policy.advancedSettings
```typescript
interface AdvancedSettings {
  ffmpegFlags: string[];      // Custom FFmpeg flags ['-preset', 'slow']
  hwaccel: string;            // Hardware acceleration method
  audioCodec: string;         // Audio codec override
  subtitleHandling: string;   // 'copy' | 'burn' | 'remove'
  customFilter: string;       // Custom FFmpeg filter chain
}
```

### Metric.codecDistribution
```typescript
interface CodecDistribution {
  [codecName: string]: number;  // Percentage or count
}

// Example:
{
  "H.264": 62,
  "HEVC": 34,
  "AV1": 4
}
```

---

## Migration Strategy

### Production Deployment
1. Always use migrations: `npx prisma migrate deploy`
2. Never use `db push` in production
3. Test migrations on staging environment first
4. Backup database before running migrations

### Rollback Strategy
```bash
# View migration history
npx prisma migrate status

# Rollback (manual process)
# 1. Restore database from backup
# 2. Run previous migration
npx prisma migrate resolve --rolled-back <migration_name>
```

---

## Performance Considerations

### BigInt Fields
- `totalSizeBytes`, `beforeSizeBytes`, `afterSizeBytes`, `savedBytes` use BigInt
- JavaScript: Use `BigInt()` constructor or `n` suffix: `1024n`
- Can store values up to 2^63-1 (9 exabytes)

### JSON Fields
- Indexed using GIN indexes in PostgreSQL (automatic)
- Use `@db.JsonB` for better query performance if needed
- Keep JSON structures flat for better performance

### Cascading Deletes
- **License deleted** → All nodes, metrics deleted
- **Node deleted** → All libraries, jobs, metrics deleted
- **Library deleted** → All jobs deleted
- **Policy deleted** → Jobs are **restricted** (must reassign before deleting)

---

## Security Best Practices

1. **Never expose apiKey or pairingToken in API responses**
   ```typescript
   // Good - exclude sensitive fields
   select: {
     id: true,
     name: true,
     status: true,
     // apiKey: false (omit)
   }
   ```

2. **Validate license before operations**
   ```typescript
   const license = await prisma.license.findUnique({
     where: { id: licenseId }
   });

   if (license.status !== 'ACTIVE' ||
       (license.validUntil && license.validUntil < new Date())) {
     throw new Error('Invalid or expired license');
   }
   ```

3. **Rate-limit heartbeat updates**
   - Don't update `lastHeartbeat` on every request
   - Batch updates every 30-60 seconds

4. **Sanitize file paths**
   - Always validate `library.path` and `job.filePath`
   - Prevent directory traversal attacks
   - Use `path.resolve()` and check if path starts with allowed directory

---

## Environment Variables

```env
# Required
DATABASE_URL="postgresql://user:password@localhost:5432/bitbonsai?schema=public"

# Optional (for connection pooling)
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Prisma Studio
PRISMA_STUDIO_PORT=5555
```

---

## Useful Commands

```bash
# Format schema
npx prisma format

# Validate schema
npx prisma validate

# Generate types and client
npx prisma generate

# Create migration
npx prisma migrate dev --name <descriptive-name>

# Apply migrations (production)
npx prisma migrate deploy

# Reset database (DEV ONLY)
npx prisma migrate reset

# Seed database
npx prisma db seed

# Open Prisma Studio
npx prisma studio
```

---

## Additional Resources

- [Prisma Documentation](https://www.prisma.io/docs)
- [PostgreSQL BigInt](https://www.postgresql.org/docs/current/datatype-numeric.html)
- [Prisma JSON Fields](https://www.prisma.io/docs/concepts/components/prisma-schema/data-model#json)
- [NestJS Prisma Integration](https://docs.nestjs.com/recipes/prisma)
