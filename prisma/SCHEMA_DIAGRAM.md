# BitBonsai Database Schema Diagram

## Entity Relationship Diagram (ERD)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            LICENSE (Central Authority)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ • id (PK)                    │ • maxConcurrentJobs                          │
│ • key (UNIQUE)               │ • features (JSON)                            │
│ • tier (ENUM)                │ • validUntil                                 │
│ • status (ENUM)              │ • stripeCustomerId                           │
│ • email                      │ • stripeSubscriptionId                       │
│ • maxNodes                   │ • createdAt, updatedAt                       │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │
          ┌───────────┴──────────┬─────────────────────────┐
          │ 1:N                  │ 1:N                     │
          ▼                      ▼                         ▼
┌─────────────────────┐  ┌──────────────────┐   ┌─────────────────────┐
│       NODE          │  │     METRIC       │   │  (future expansion) │
├─────────────────────┤  ├──────────────────┤   └─────────────────────┘
│ • id (PK)           │  │ • id (PK)        │
│ • name              │  │ • date           │
│ • role (ENUM)       │  │ • nodeId (FK)    │
│ • status (ENUM)     │  │ • licenseId (FK) │
│ • version           │  │ • jobsCompleted  │
│ • acceleration      │  │ • jobsFailed     │
│ • pairingToken      │  │ • totalSavedBytes│
│ • apiKey (UNIQUE)   │  │ • avgThroughput  │
│ • lastHeartbeat     │  │ • codecDist (JSON)│
│ • uptimeSeconds     │  │ • createdAt      │
│ • licenseId (FK)    │  └──────────────────┘
│ • createdAt         │
│ • updatedAt         │
└──────────┬──────────┘
           │
           ├──────────┬───────────┬────────────┐
           │ 1:N      │ 1:N       │ 1:N        │
           ▼          ▼           ▼            │
┌──────────────┐ ┌─────────┐ ┌─────────┐      │
│   LIBRARY    │ │   JOB   │ │ METRIC  │      │
├──────────────┤ ├─────────┤ └─────────┘      │
│ • id (PK)    │ │(detail) │                  │
│ • name       │ │  below  │                  │
│ • path       │ └─────────┘                  │
│ • mediaType  │                              │
│ • enabled    │                              │
│ • lastScanAt │                              │
│ • totalFiles │                              │
│ • totalSize  │                              │
│ • nodeId (FK)│                              │
│ • createdAt  │                              │
│ • updatedAt  │                              │
└──────┬───────┘                              │
       │                                      │
       ├───────────┐                          │
       │ 1:N       │ 1:N                      │
       ▼           ▼                          │
┌──────────────┐ ┌─────────────────────────────────────────┐
│   POLICY     │ │              JOB                        │
├──────────────┤ ├─────────────────────────────────────────┤
│ • id (PK)    │ │ • id (PK)                               │
│ • name       │ │ • filePath                              │
│ • preset     │ │ • fileLabel                             │
│ • targetCodec│ │ • sourceCodec, targetCodec              │
│ • quality    │ │ • stage (ENUM)                          │
│ • deviceProf │ │ • progress, etaSeconds                  │
│ • advSettings│ │ • beforeSize, afterSize                 │
│ • atomic     │ │ • savedBytes, savedPercent              │
│ • verify     │ │ • startedAt, completedAt                │
│ • skipSeed   │ │ • error                                 │
│ • libraryId  │ │ • nodeId (FK), libraryId (FK)           │
│ • createdAt  │ │ • policyId (FK)                         │
│ • updatedAt  │ │ • createdAt, updatedAt                  │
└──────────────┘ └─────────────────────────────────────────┘
```

---

## Relationship Summary

### License (Hub Model)
- **Has Many** → Nodes (1:N)
- **Has Many** → Metrics (1:N)
- **Controls**: Maximum nodes, concurrent jobs, feature access

### Node (Worker Model)
- **Belongs To** → License (N:1)
- **Has Many** → Libraries (1:N)
- **Has Many** → Jobs (1:N)
- **Has Many** → Metrics (1:N)
- **Purpose**: Physical/virtual machine running encoding worker

### Library (Storage Model)
- **Belongs To** → Node (N:1)
- **Has Many** → Policies (1:N)
- **Has Many** → Jobs (1:N)
- **Purpose**: Monitored media folder

### Policy (Rules Model)
- **Belongs To** → Library (N:1, optional)
- **Has Many** → Jobs (1:N)
- **Purpose**: Encoding rules and parameters

### Job (Work Model)
- **Belongs To** → Node (N:1)
- **Belongs To** → Library (N:1)
- **Belongs To** → Policy (N:1)
- **Purpose**: Single file encoding task

### Metric (Analytics Model)
- **Belongs To** → Node (N:1, optional)
- **Belongs To** → License (N:1, optional)
- **Purpose**: Aggregated statistics for insights

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     1. LICENSE VALIDATION                                   │
│  User enters license key → Validate tier, status, validUntil               │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     2. NODE REGISTRATION                                    │
│  Node generates pairing token → Main node validates → Issues API key       │
│  Node sends heartbeats every 60s → Update lastHeartbeat                    │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     3. LIBRARY SCANNING                                     │
│  Node scans library path → Detects media files → Creates job records       │
│  Updates library.totalFiles, library.totalSizeBytes                         │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     4. POLICY APPLICATION                                   │
│  Match library → policy → Determine encoding parameters                    │
│  Check device profiles, quality settings, advanced options                 │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     5. JOB QUEUING                                          │
│  Job stage: DETECTED → QUEUED                                              │
│  Assign to available node based on license.maxConcurrentJobs               │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     6. ENCODING PROCESS                                     │
│  Job stage: QUEUED → ENCODING                                              │
│  Update progress%, etaSeconds every 5-10 seconds                           │
│  Monitor node health via heartbeat                                         │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     7. VERIFICATION                                         │
│  Job stage: ENCODING → VERIFYING                                           │
│  Check output file integrity, playability                                  │
│  Calculate savedBytes, savedPercent                                        │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     8. COMPLETION                                           │
│  Job stage: VERIFYING → COMPLETED/FAILED                                   │
│  Set completedAt timestamp                                                 │
│  Update metric records (jobsCompleted, totalSavedBytes)                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Cascade Delete Behavior

```
LICENSE deleted
   └─→ DELETE all nodes
       └─→ DELETE all libraries
           └─→ DELETE all jobs
       └─→ DELETE all jobs
       └─→ DELETE all metrics
   └─→ DELETE all metrics

NODE deleted
   └─→ DELETE all libraries
       └─→ DELETE all jobs
   └─→ DELETE all jobs
   └─→ DELETE all metrics

LIBRARY deleted
   └─→ SET NULL on policies (optional relationship)
   └─→ DELETE all jobs

POLICY deleted
   └─→ RESTRICT (cannot delete if jobs reference it)
       └─→ Must reassign jobs to another policy first
```

---

## Index Strategy

### Primary Indexes (for lookups)
- `license.key` (UNIQUE) - License validation
- `node.apiKey` (UNIQUE) - API authentication
- `node.pairingToken` (UNIQUE) - Node pairing

### Performance Indexes
- `license.status` - Filter active licenses
- `license.email` - User lookup
- `node.status` - Filter online nodes
- `node.lastHeartbeat` - Health monitoring
- `job.stage` - Queue queries
- `job.[stage, nodeId]` - Composite for "get next job"
- `job.completedAt` - Historical analytics
- `library.enabled` - Filter active libraries
- `metric.date` - Time-series queries
- `metric.[date, nodeId]` - Time-series per node

---

## Query Patterns

### Common Query 1: Get Next Job for Node
```sql
SELECT * FROM jobs
WHERE stage = 'QUEUED'
  AND nodeId = ?
ORDER BY createdAt ASC
LIMIT 1;
```
**Index Used**: `[stage, nodeId]` composite index

### Common Query 2: Node Dashboard Stats
```sql
SELECT
  COUNT(*) FILTER (WHERE stage = 'COMPLETED') as completed,
  COUNT(*) FILTER (WHERE stage = 'FAILED') as failed,
  COUNT(*) FILTER (WHERE stage = 'ENCODING') as active
FROM jobs
WHERE nodeId = ?
  AND createdAt >= NOW() - INTERVAL '24 hours';
```
**Index Used**: `nodeId`

### Common Query 3: Storage Savings Report
```sql
SELECT
  SUM(savedBytes) as totalSaved,
  AVG(savedPercent) as avgSavings
FROM jobs
WHERE stage = 'COMPLETED'
  AND savedBytes > 0
  AND completedAt >= ?
  AND completedAt <= ?;
```
**Index Used**: `completedAt`

### Common Query 4: License Usage Check
```sql
SELECT
  license.maxNodes,
  COUNT(DISTINCT nodes.id) as activeNodes,
  license.maxConcurrentJobs,
  COUNT(jobs.id) FILTER (WHERE jobs.stage = 'ENCODING') as runningJobs
FROM licenses
LEFT JOIN nodes ON nodes.licenseId = licenses.id AND nodes.status = 'ONLINE'
LEFT JOIN jobs ON jobs.nodeId = nodes.id
WHERE licenses.id = ?
GROUP BY licenses.id;
```
**Indexes Used**: `licenseId` on nodes, `nodeId` on jobs

---

## Data Volume Estimates

### Small Deployment (Home User)
- 1 License
- 1 Node
- 3 Libraries (~5,000 files)
- 5 Policies
- 10,000 Jobs (lifetime)
- 365 Metrics (1 year daily)
- **Estimated Size**: ~50 MB (SQLite)

### Medium Deployment (Enthusiast)
- 1 License
- 3 Nodes
- 10 Libraries (~50,000 files)
- 20 Policies
- 100,000 Jobs (lifetime)
- 1,095 Metrics (3 years daily)
- **Estimated Size**: ~500 MB (SQLite)

### Large Deployment (Small Business)
- 5 Licenses
- 20 Nodes
- 50 Libraries (~500,000 files)
- 100 Policies
- 1,000,000 Jobs (lifetime)
- 7,300 Metrics (20 nodes × 365 days)
- **Estimated Size**: ~5 GB (PostgreSQL recommended)

---

## JSON Field Examples

### License.features
```json
{
  "multiNode": true,
  "advancedPresets": true,
  "api": true,
  "priorityQueue": true,
  "cloudStorage": true,
  "webhooks": true,
  "qualityAnalysis": true,
  "hardwareAcceleration": true
}
```

### Policy.deviceProfiles
```json
{
  "appleTv": true,
  "roku": true,
  "web": true,
  "chromecast": true,
  "ps5": true,
  "xbox": true,
  "fireTv": true,
  "androidTv": true
}
```

### Policy.advancedSettings
```json
{
  "ffmpegFlags": ["-preset", "medium", "-tune", "film"],
  "hwaccel": "cuda",
  "audioCodec": "copy",
  "subtitleHandling": "copy",
  "targetResolution": "1920x1080",
  "maxBitrate": 10000000,
  "hdrToSdr": false,
  "deinterlace": "auto"
}
```

### Metric.codecDistribution
```json
{
  "H.264": 62,
  "HEVC": 34,
  "AV1": 4
}
```

---

## Migration Timeline

### Phase 1: Initial Schema (v0.1.0)
- All 6 core models
- Basic indexes
- SQLite default

### Phase 2: Optimization (v0.2.0)
- Add composite indexes for common queries
- Implement metric aggregation cron job
- Add job archival for old completed jobs

### Phase 3: Multi-Tenancy (v0.3.0)
- Add organization model (if needed)
- Implement row-level security (PostgreSQL)
- Add user roles and permissions

### Phase 4: Advanced Features (v0.4.0)
- Add quality analysis results model
- Implement webhook delivery tracking
- Add cloud storage sync status

---

## Backup & Recovery Strategy

### SQLite (Default)
```bash
# Backup
sqlite3 prisma/bitbonsai.db ".backup 'backup.db'"

# Restore
cp backup.db prisma/bitbonsai.db
```

### PostgreSQL (Commercial)
```bash
# Backup
pg_dump -U username -d bitbonsai > backup.sql

# Restore
psql -U username -d bitbonsai < backup.sql
```

### Recommended Schedule
- **Development**: Manual backups before schema changes
- **Production**: Daily automated backups, 30-day retention
- **Critical**: Hourly backups during high-value encoding operations

---

This diagram provides a complete overview of the BitBonsai database architecture, designed for scalability from single-node home setups to commercial multi-node deployments.
