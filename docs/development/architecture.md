# BitBonsai Architecture

> **System design, architecture decisions, and technical implementation details**

This document provides a comprehensive overview of BitBonsai's architecture, design patterns, and core systems.

---

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [Technology Stack](#technology-stack)
- [System Architecture](#system-architecture)
- [Core Services](#core-services)
- [TRUE RESUME & Auto-Heal System](#true-resume--auto-heal-system)
- [Distributed Encoding](#distributed-encoding)
- [Data Layer](#data-layer)
- [Frontend Architecture](#frontend-architecture)
- [Security & Authentication](#security--authentication)
- [Performance Optimizations](#performance-optimizations)
- [Design Decisions](#design-decisions)

---

## High-Level Overview

BitBonsai is a **distributed media automation platform** built on a modern full-stack architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Angular 20)                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐ │
│  │ Dashboard  │  │   Queue    │  │  Node Management       │ │
│  │ Analytics  │  │  Policies  │  │  Real-time Updates     │ │
│  └────────────┘  └────────────┘  └────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket + HTTP
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (NestJS 11)                       │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │   REST API  │  │   WebSocket  │  │   Job Scheduler    │ │
│  │   Gateway   │  │   Gateway    │  │   (BullMQ/Queue)   │ │
│  └─────────────┘  └──────────────┘  └────────────────────┘ │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │  Encoding   │  │   Discovery  │  │   Auto-Heal        │ │
│  │  Processor  │  │   Service    │  │   Recovery         │ │
│  └─────────────┘  └──────────────┘  └────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Prisma ORM
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Data Layer (PostgreSQL)                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐ │
│  │  Encoding  │  │   Nodes    │  │   Libraries & Policies │ │
│  │   Jobs     │  │  (Main +   │  │   Settings & Users     │ │
│  │            │  │  Children) │  │                        │ │
│  └────────────┘  └────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Angular** | 20.x | Modern web framework with standalone components |
| **NgRx** | 20.x | Reactive state management (Redux pattern) |
| **RxJS** | 7.8.x | Reactive programming, observables, streams |
| **Socket.IO Client** | 4.8.x | Real-time WebSocket communication |
| **Chart.js** | 4.5.x | Analytics visualizations |
| **Tailwind CSS** | 3.4.x | Utility-first CSS framework |
| **FontAwesome Pro** | 7.1.x | Icon library |

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **NestJS** | 11.x | Progressive Node.js framework (TypeScript) |
| **Prisma** | 6.16.x | Next-generation ORM with type safety |
| **Socket.IO** | 4.8.x | Real-time WebSocket server |
| **BullMQ** | 5.x | Distributed job queue (Redis-backed) |
| **Winston** | 3.18.x | Structured logging |
| **FFmpeg** | 7.1+ | Media encoding engine |
| **Passport JWT** | 4.0.x | Authentication strategy |
| **Bonjour Service** | 1.3.x | mDNS service discovery |

### Database

| Technology | Version | Purpose |
|------------|---------|---------|
| **PostgreSQL** | 16.x | Primary database (commercial tier) |
| **SQLite** | 3.x | Embedded database (free tier) |
| **Redis** | 7.x | Job queue and caching (commercial tier) |

### Build & Tooling

| Technology | Version | Purpose |
|------------|---------|---------|
| **Nx** | 22.x | Monorepo build system |
| **Biome** | 2.2.x | Fast linter & formatter |
| **Husky** | 9.x | Git hooks for quality gates |
| **Playwright** | 1.56.x | E2E testing framework |
| **Jest** | 30.x | Unit & integration testing |

---

## System Architecture

### Monorepo Structure

```
bitbonsai/
├── apps/
│   ├── frontend/          # Angular 20 standalone application
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── core/          # Singletons (auth, HTTP, guards)
│   │   │   │   ├── features/      # Feature modules
│   │   │   │   │   ├── dashboard/
│   │   │   │   │   ├── queue/
│   │   │   │   │   ├── nodes/
│   │   │   │   │   └── node-setup/
│   │   │   │   ├── shared/        # Reusable components
│   │   │   │   └── state/         # NgRx store
│   │   │   └── environments/
│   │   └── project.json
│   │
│   └── backend/           # NestJS REST API + WebSocket
│       ├── src/
│       │   ├── main.ts
│       │   ├── encoding/          # Encoding logic
│       │   │   ├── encoding.module.ts
│       │   │   ├── encoding.service.ts
│       │   │   └── encoding-processor.service.ts
│       │   ├── queue/             # Job queue management
│       │   ├── nodes/             # Node registration & discovery
│       │   ├── discovery/         # mDNS service discovery
│       │   ├── libraries/         # Media library management
│       │   ├── policies/          # Encoding policy engine
│       │   ├── settings/          # System configuration
│       │   └── websocket/         # Real-time updates
│       └── project.json
│
├── libs/                  # Shared libraries (future)
│   └── shared-models/     # TypeScript interfaces
│
├── prisma/
│   ├── schema.prisma      # Database schema
│   └── migrations/        # Migration history
│
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── docker-compose.unraid.yml
│
├── deploy-lxc/            # Proxmox LXC deployment
│   └── deploy-to-proxmox.sh
│
└── scripts/
    ├── update-version.js
    ├── reset-test-env.sh
    └── generate-unraid-release.sh
```

### Request Flow

**Encoding Job Submission:**

```
User Action (Frontend)
      │
      ▼
Angular Component dispatches NgRx Action
      │
      ▼
NgRx Effect calls API Service
      │
      ▼
HTTP Client → REST API Endpoint (/api/v1/jobs)
      │
      ▼
NestJS Controller validates DTO
      │
      ▼
Service Layer (JobService)
      │
      ├──> Prisma ORM → PostgreSQL (persist job)
      │
      ├──> BullMQ → Redis (enqueue job)
      │
      └──> WebSocket Gateway → Broadcast "job_queued"
                │
                ▼
          All connected clients receive update
                │
                ▼
          NgRx Effect updates state → UI auto-refreshes
```

---

## Core Services

### 1. Encoding Processor Service

**Location:** `apps/backend/src/encoding/encoding-processor.service.ts`

**Responsibilities:**
- Executes FFmpeg encoding jobs
- Manages temp file I/O (SSD cache pool support)
- Implements TRUE RESUME (resume from timestamp)
- Progress tracking via FFmpeg stderr parsing
- File verification after encoding

**Key Methods:**
- `processJob(job: EncodingJob)` - Main encoding orchestrator
- `buildFFmpegCommand(job, outputPath)` - Construct FFmpeg args
- `parseProgress(line: string)` - Extract FPS, % complete, ETA
- `verifyEncodedFile(outputPath)` - Check integrity
- `replaceOriginalFile(job, outputPath)` - Atomic file replacement

**FFmpeg Integration:**
```typescript
// apps/backend/src/encoding/encoding-processor.service.ts:1200-1250

private buildFFmpegCommand(job: EncodingJob, outputPath: string): string[] {
  const args = ['-hide_banner'];

  // TRUE RESUME: Resume from last progress if temp file exists
  if (job.resumePosition) {
    args.push('-ss', this.formatTimestamp(job.resumePosition));
  }

  args.push('-i', job.filePath);

  // Hardware acceleration
  if (job.useGPU) {
    args.push('-hwaccel', this.detectHWAccel());
    args.push('-c:v', this.detectEncoder(job.targetCodec));
  } else {
    args.push('-c:v', this.getSwEncoder(job.targetCodec));
  }

  // Quality settings
  args.push('-crf', job.quality.toString());
  args.push('-preset', job.preset);

  // Audio/subtitle copy
  args.push('-c:a', 'copy');
  args.push('-c:s', 'copy');

  // Map all streams
  args.push('-map', '0');

  // Output to temp file (cache pool for SSD I/O)
  const tmpPath = this.ENCODING_TEMP_PATH
    ? path.join(this.ENCODING_TEMP_PATH, `.${basename(outputPath)}.tmp-${job.id}`)
    : path.join(dirname(job.filePath), `.${basename(outputPath)}.tmp-${job.id}`);

  args.push('-y', tmpPath);

  return args;
}
```

### 2. Auto-Heal Service

**Location:** `apps/backend/src/queue/services/auto-heal.service.ts`

**Responsibilities:**
- Scan for orphaned jobs on startup (ENCODING, HEALTH_CHECK, VERIFYING states)
- 4-layer defense against Docker volume mount race conditions
- Validate temp files for TRUE RESUME capability
- Calculate resume position from temp file duration
- Reset jobs to QUEUED for automatic retry

**4-Layer Defense Architecture:**

```typescript
// apps/backend/src/queue/services/auto-heal.service.ts:45-150

async healOrphanedJobs(): Promise<void> {
  // Layer 1: Initial delay (2 seconds)
  await this.delay(2000);

  // Layer 2: Volume mount probing (10 retries @ 1 second)
  let retries = 0;
  const maxRetries = 10;
  while (retries < maxRetries) {
    const mediaPaths = this.configService.get<string>('MEDIA_PATHS').split(',');
    const allPathsExist = mediaPaths.every(p => fs.existsSync(p));

    if (allPathsExist) {
      this.logger.log('✅ Volume mounts ready, proceeding with auto-heal');
      break;
    }

    retries++;
    this.logger.warn(`⏳ Waiting for volume mounts... (${retries}/${maxRetries})`);
    await this.delay(1000);
  }

  // Layer 3: Stabilization delay (3 seconds)
  await this.delay(3000);

  // Layer 4: Temp file validation with retry logic
  const orphanedJobs = await this.prisma.encodingJob.findMany({
    where: {
      stage: { in: ['ENCODING', 'HEALTH_CHECK', 'VERIFYING'] }
    }
  });

  for (const job of orphanedJobs) {
    const canResume = await this.validateTempFile(job.id, 5); // 5 retries

    if (canResume) {
      // TRUE RESUME: Extract duration from temp file
      const resumePosition = await this.extractDuration(job.tempFilePath);
      await this.prisma.encodingJob.update({
        where: { id: job.id },
        data: {
          stage: 'QUEUED',
          resumePosition,
          errorMessage: null
        }
      });
      this.logger.log(`✅ TRUE RESUME: Will resume from ${resumePosition}`);
    } else {
      // Safe fallback: Restart from 0%
      await this.prisma.encodingJob.update({
        where: { id: job.id },
        data: {
          stage: 'QUEUED',
          progress: 0,
          resumePosition: null,
          errorMessage: null
        }
      });
      this.logger.warn(`⚠️ Temp file missing, will restart from 0%`);
    }
  }
}
```

**Why 4 Layers?**

1. **Layer 1 (Initial Delay)** - Basic container initialization, prevents immediate file system access
2. **Layer 2 (Volume Probing)** - Docker volumes may not mount immediately, especially on Unraid/NFS/SMB
3. **Layer 3 (Stabilization)** - FUSE/NFS/SMB mounts need settling time to be responsive
4. **Layer 4 (Temp File Validation)** - Distinguish between "resume from progress" vs "restart from 0%"

### 3. Discovery Service (mDNS)

**Location:** `apps/backend/src/discovery/discovery.controller.ts`

**Responsibilities:**
- Broadcast mDNS service (`_bitbonsai._tcp.local`) for auto-discovery
- Handle pairing requests from child nodes
- Generate 6-digit pairing codes
- Validate pairing approval from MAIN node dashboard
- Establish WebSocket connection for job distribution

**mDNS Broadcast:**
```typescript
// apps/backend/src/discovery/discovery.service.ts:30-50

private startMDNSBroadcast() {
  const bonjour = new Bonjour();

  this.mdnsService = bonjour.publish({
    name: this.getNodeName(),
    type: 'bitbonsai',
    protocol: 'tcp',
    port: this.configService.get<number>('API_PORT', 3100),
    txt: {
      version: this.packageVersion,
      hwaccel: this.detectHardwareAcceleration(),
      cpuCores: os.cpus().length.toString(),
      totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB'
    }
  });

  this.logger.log(`📡 mDNS broadcast started: ${this.mdnsService.name}._bitbonsai._tcp.local`);
}
```

**Pairing Flow:**
```
Child Node                         Main Node
     │                                  │
     │  1. Scan for mDNS services       │
     │ ──────────────────────────────>  │
     │                                  │
     │  2. Discover main nodes          │
     │ <────────────────────────────────│
     │                                  │
     │  3. Request pairing (POST /pair) │
     │ ──────────────────────────────>  │
     │                                  │
     │  4. Generate pairing code (6-digit)
     │ <────────────────────────────────│
     │                                  │
     │  5. User approves on dashboard   │
     │                (WebUI)           │
     │                                  │
     │  6. Poll status (GET /pair/:id)  │
     │ ──────────────────────────────>  │
     │ ──────────────────────────────>  │
     │ ──────────────────────────────>  │
     │                                  │
     │  7. Return connection token      │
     │ <────────────────────────────────│
     │                                  │
     │  8. Establish WebSocket          │
     │ <════════════════════════════════>
     │                                  │
     │  9. Begin receiving jobs         │
     │ <────────────────────────────────│
```

### 4. Queue Service (BullMQ)

**Location:** `apps/backend/src/queue/queue.service.ts`

**Responsibilities:**
- Job queue management (FIFO with priority)
- Distributed job processing across nodes
- Concurrent job limits per node
- Retry logic with exponential backoff
- Job state persistence

**Priority Queue:**
```typescript
// apps/backend/src/queue/queue.service.ts:100-150

async addJob(job: EncodingJob, priority: number = 0): Promise<void> {
  await this.jobQueue.add('encode', job, {
    priority,  // Higher = processed first
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000  // 2s, 4s, 8s
    },
    removeOnComplete: 100,  // Keep last 100 completed
    removeOnFail: 500       // Keep last 500 failed
  });
}

async pinJob(jobId: string): Promise<void> {
  // Move job to top of queue
  const job = await this.prisma.encodingJob.findUnique({ where: { id: jobId } });

  // Re-add with max priority
  await this.addJob(job, 999);

  // Emit event for UI update
  this.eventEmitter.emit('job.pinned', job);
}
```

---

## TRUE RESUME & Auto-Heal System

### TRUE RESUME Technology

Traditional encoders restart from 0% after crashes. BitBonsai's TRUE RESUME preserves exact progress:

**How it works:**

1. **Temp File Strategy**
   - FFmpeg writes to temp file: `.filename.mkv.tmp-{jobId}`
   - Stored on SSD cache pool for 10-100x faster I/O
   - Temp file remains after crash/restart

2. **Progress Tracking**
   - FFmpeg stderr parsed for current timestamp
   - Progress saved to database every 5 seconds
   - `resumePosition` field stores `HH:MM:SS` timestamp

3. **Resume Logic**
   - On job restart, check if temp file exists
   - Extract duration from temp file using FFprobe
   - Resume FFmpeg from `-ss {resumePosition}`
   - Append to temp file (seamless continuation)

4. **Verification**
   - Compare temp file duration to source duration
   - Ensure quality metrics match (CRF tolerance ±2)
   - Atomic file replacement after verification

**Example:**

```typescript
// apps/backend/src/encoding/encoding-processor.service.ts:850-900

async resumeJob(job: EncodingJob): Promise<void> {
  const tempFilePath = this.getTempFilePath(job);

  // Validate temp file exists
  if (!fs.existsSync(tempFilePath)) {
    this.logger.warn(`Temp file missing, restarting from 0%`);
    return this.processJob(job);
  }

  // Extract encoded duration from temp file
  const encodedDuration = await this.extractDuration(tempFilePath);
  const sourceDuration = await this.extractDuration(job.filePath);

  // Calculate resume position
  const resumePosition = this.calculateResumePosition(encodedDuration, sourceDuration);

  this.logger.log(`✅ TRUE RESUME: Resuming from ${resumePosition} (${job.progress}% complete)`);

  // Build FFmpeg command with -ss flag
  const ffmpegArgs = this.buildFFmpegCommand(job, tempFilePath);
  ffmpegArgs.unshift('-ss', resumePosition);  // Seek to resume position

  // Resume encoding
  await this.executeFFmpeg(ffmpegArgs, job);
}
```

### Auto-Heal System Benefits

**Production-Tested Reliability:**

- **Docker Compose**: Handles service restart dependencies
- **Unraid**: Survives array stops, cache pool remounts
- **Kubernetes**: Handles pod evictions, node failures
- **Proxmox LXC**: Handles container snapshots, live migrations

**Real-World Example:**

```
[08:00:00] Backend started
[08:00:02] 🔍 Layer 1: Initial delay complete
[08:00:03] ⏳ Layer 2: Probing volume mounts... (1/10)
[08:00:04] ⏳ Layer 2: Probing volume mounts... (2/10)
[08:00:05] ✅ Layer 2: Volume mounts ready
[08:00:08] ✅ Layer 3: Stabilization complete
[08:00:08] 🔍 Layer 4: Scanning for orphaned jobs...
[08:00:09] 🔄 Found 15 orphaned jobs
[08:00:10] ✅ TRUE RESUME: Temp file found for "Star Wars.mkv"
[08:00:10] ✅ TRUE RESUME: Will resume from 00:01:19 (1.06% of 2h 4m)
[08:00:11] ✅ 15 jobs reset to QUEUED
[08:00:12] 🚀 Encoding resumed automatically
```

---

## Distributed Encoding

### Architecture

```
Main Node (MAIN)                       Child Node 1
┌─────────────────┐                   ┌─────────────────┐
│   Dashboard     │                   │                 │
│   Job Queue     │ ───WebSocket───> │  FFmpeg Worker  │
│   Database      │ <──Progress────   │  Temp Storage   │
│   Redis/BullMQ  │                   │                 │
└─────────────────┘                   └─────────────────┘
        │                                      │
        │                                      │
        │                             Child Node 2
        │                            ┌─────────────────┐
        │                            │                 │
        │──────WebSocket──────────> │  FFmpeg Worker  │
        │<─────Progress────────────  │  Temp Storage   │
        │                            │                 │
        │                            └─────────────────┘
        │
        ▼
  PostgreSQL + Redis
```

### Job Distribution Algorithm

**Location:** `apps/backend/src/queue/queue.service.ts:200-300`

**Strategy: Least-Loaded Node with Capability Matching**

```typescript
async selectBestNode(job: EncodingJob): Promise<Node> {
  const availableNodes = await this.prisma.node.findMany({
    where: {
      status: 'ONLINE',
      activeJobs: { lt: this.getNodeMaxJobs() }
    },
    include: {
      _count: { select: { encodingJobs: true } }
    }
  });

  // Filter by capability (GPU vs CPU)
  const capableNodes = availableNodes.filter(node => {
    if (job.useGPU) {
      return node.hwAccel !== 'CPU';
    }
    return true;
  });

  // Sort by least loaded (fewest active jobs)
  capableNodes.sort((a, b) => a._count.encodingJobs - b._count.encodingJobs);

  // Return least loaded capable node
  return capableNodes[0];
}
```

**Capabilities Considered:**
- **GPU Type**: NVENC, QSV, AMF, Apple Silicon
- **Active Jobs**: Current load
- **CPU Cores**: Parallel processing capacity
- **Network Latency**: Response time (for remote nodes)

### Load Balancing

**Round-Robin with Weighted Fair Queuing:**

```typescript
// Assign job to least-loaded node with required capabilities
const targetNode = await this.selectBestNode(job);

// Update node active jobs counter
await this.prisma.node.update({
  where: { id: targetNode.id },
  data: { activeJobs: { increment: 1 } }
});

// Emit job via WebSocket
this.websocketGateway.emitToNode(targetNode.id, 'job_assigned', job);
```

---

## Data Layer

### Database Schema (Prisma)

**Location:** `prisma/schema.prisma`

**Key Models:**

```prisma
model Node {
  id              String   @id @default(cuid())
  name            String   @unique
  type            NodeType @default(MAIN)  // MAIN | CHILD
  publicUrl       String
  apiUrl          String
  hwAccel         String   @default("CPU") // CPU | NVENC | QSV | AMF | M_SERIES
  cpuCores        Int      @default(1)
  totalMemory     Int      @default(0)
  status          NodeStatus @default(OFFLINE)  // ONLINE | OFFLINE | ERROR
  version         String
  activeJobs      Int      @default(0)
  registrationRequests RegistrationRequest[]
  encodingJobs    EncodingJob[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model EncodingJob {
  id              String   @id @default(cuid())
  filePath        String
  library         Library  @relation(fields: [libraryId], references: [id])
  libraryId       String
  policy          Policy   @relation(fields: [policyId], references: [id])
  policyId        String
  node            Node?    @relation(fields: [nodeId], references: [id])
  nodeId          String?
  stage           EncodingStage  // QUEUED | ENCODING | VERIFYING | COMPLETED | FAILED
  progress        Float    @default(0)
  resumePosition  String?  // HH:MM:SS timestamp for TRUE RESUME
  fps             Float?
  eta             String?
  errorMessage    String?
  sourceCodec     String
  targetCodec     String
  quality         Int      // CRF value
  useGPU          Boolean  @default(false)
  priority        Int      @default(0)  // Higher = processed first
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  startedAt       DateTime?
  completedAt     DateTime?
  failedAt        DateTime?
}

model Library {
  id              String   @id @default(cuid())
  name            String   @unique
  path            String
  type            LibraryType  // MOVIES | TV_SHOWS | ANIME | GENERAL
  scanOnStartup   Boolean  @default(false)
  totalFiles      Int      @default(0)
  totalSize       BigInt   @default(0)
  lastScannedAt   DateTime?
  encodingJobs    EncodingJob[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Policy {
  id              String   @id @default(cuid())
  name            String   @unique
  description     String?
  sourceCodec     String   // H264 | HEVC | AV1 | VP9 | MPEG2
  targetCodec     String   // HEVC | AV1 | H264
  quality         Int      // CRF value (18-28)
  preset          String   // ultrafast | fast | medium | slow | veryslow
  useGPU          Boolean  @default(true)
  keepOriginal    Boolean  @default(false)
  minFileSize     BigInt?  // Bytes
  maxFileSize     BigInt?  // Bytes
  libraries       Library[]
  encodingJobs    EncodingJob[]
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model RegistrationRequest {
  id              String   @id @default(cuid())
  childNodeName   String
  childNodeUrl    String
  mainNode        Node     @relation(fields: [mainNodeId], references: [id])
  mainNodeId      String
  status          RequestStatus  // PENDING | APPROVED | REJECTED
  pairingCode     String   @unique  // 6-digit code
  hwAccel         String
  cpuCores        Int
  totalMemory     Int
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  expiresAt       DateTime  // 2 minutes from creation
}
```

### Migrations

**Location:** `prisma/migrations/`

**Recent Migrations:**
- `20251106201008_add_node_registration_requests` - Node pairing system
- `20251110150024_add_max_auto_heal_retries` - Auto-heal retry limits
- `20251112183045_add_resume_position` - TRUE RESUME support

**Running Migrations:**
```bash
# Generate Prisma Client
npx prisma generate

# Apply pending migrations
npx prisma migrate deploy

# Reset database (dev only)
npx prisma migrate reset

# Create new migration
npx prisma migrate dev --name add_new_feature
```

---

## Frontend Architecture

### State Management (NgRx)

**Location:** `apps/frontend/src/app/state/`

**Store Slices:**

```typescript
// Queue State
interface QueueState {
  jobs: {
    active: EncodingJob[];
    pending: EncodingJob[];
    completed: EncodingJob[];
    failed: EncodingJob[];
  };
  filters: {
    libraryId: string | null;
    status: string | null;
  };
  loading: boolean;
}

// Node State
interface NodeState {
  nodes: Node[];
  selectedNode: Node | null;
  registrationRequests: RegistrationRequest[];
  loading: boolean;
}

// Dashboard State
interface DashboardState {
  statistics: {
    totalJobs: number;
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
    spaceSaved: number;
  };
  codecDistribution: CodecDistribution[];
  recentActivity: Activity[];
}
```

**Data Flow:**

```typescript
// Component dispatches action
this.store.dispatch(QueueActions.loadJobs());

// Effect handles async operation
@Effect()
loadJobs$ = this.actions$.pipe(
  ofType(QueueActions.loadJobs),
  switchMap(() => this.queueService.getJobs()),
  map(jobs => QueueActions.loadJobsSuccess({ jobs })),
  catchError(error => of(QueueActions.loadJobsFailure({ error })))
);

// Reducer updates state
case QueueActions.loadJobsSuccess:
  return {
    ...state,
    jobs: action.jobs,
    loading: false
  };

// Component selects from store
jobs$ = this.store.select(selectActiveJobs);
```

### Real-Time Updates (WebSocket)

**Location:** `apps/frontend/src/app/core/services/websocket.service.ts`

**Event Subscription:**

```typescript
class WebSocketService {
  private socket: Socket;

  connect(): void {
    this.socket = io(environment.apiUrl, {
      transports: ['websocket'],
      autoConnect: true
    });

    // Job progress updates
    this.socket.on('job_progress', (update: JobProgressUpdate) => {
      this.store.dispatch(QueueActions.updateJobProgress({ update }));
    });

    // Job completed
    this.socket.on('job_completed', (job: EncodingJob) => {
      this.store.dispatch(QueueActions.jobCompleted({ job }));
      this.toastService.success(`Encoding completed: ${job.filePath}`);
    });

    // Node status changed
    this.socket.on('node_status', (node: Node) => {
      this.store.dispatch(NodeActions.updateNodeStatus({ node }));
    });
  }
}
```

**Backend WebSocket Gateway:**

```typescript
// apps/backend/src/websocket/websocket.gateway.ts

@WebSocketGateway({ cors: true })
export class WebSocketGateway {
  @WebSocketServer()
  server: Server;

  // Broadcast to all clients
  broadcastJobProgress(job: EncodingJob, progress: number) {
    this.server.emit('job_progress', {
      jobId: job.id,
      progress,
      fps: job.fps,
      eta: job.eta
    });
  }

  // Emit to specific node
  emitToNode(nodeId: string, event: string, data: any) {
    this.server.to(`node-${nodeId}`).emit(event, data);
  }
}
```

---

## Security & Authentication

### JWT Authentication

**Token Flow:**

```
Login Request
     │
     ▼
POST /api/v1/auth/login { username, password }
     │
     ▼
Validate credentials (bcrypt)
     │
     ▼
Generate JWT token (HS256, 24h expiration)
     │
     ▼
Return { accessToken, user }
     │
     ▼
Frontend stores token in localStorage
     │
     ▼
All subsequent requests include:
  Authorization: Bearer {token}
```

**JWT Payload:**

```typescript
{
  sub: user.id,        // Subject (user ID)
  username: user.username,
  role: user.role,     // ADMIN | USER
  iat: 1699999999,     // Issued at
  exp: 1700086399      // Expires (24h later)
}
```

### Guards & Middleware

**Auth Guard:**
```typescript
// apps/frontend/src/app/core/guards/auth.guard.ts

canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) {
  const token = localStorage.getItem('access_token');

  if (!token || this.isTokenExpired(token)) {
    this.router.navigate(['/login']);
    return false;
  }

  return true;
}
```

**JWT Strategy:**
```typescript
// apps/backend/src/auth/jwt.strategy.ts

async validate(payload: JwtPayload) {
  const user = await this.userService.findById(payload.sub);

  if (!user) {
    throw new UnauthorizedException();
  }

  return user;  // Attached to request.user
}
```

---

## Performance Optimizations

### 1. SSD Cache Pool (Unraid)

**Problem:** Encoding to HDD array = 5+ hour encodes for 4K videos

**Solution:** Temp files on SSD cache pool

```typescript
// Environment variable configuration
ENCODING_TEMP_PATH=/cache  // SSD cache pool

// Encoding processor
const tmpPath = this.ENCODING_TEMP_PATH
  ? path.join(this.ENCODING_TEMP_PATH, `.${outputName}.tmp-${job.id}`)
  : path.join(path.dirname(job.filePath), `.${outputName}.tmp-${job.id}`);
```

**Result:** 10-100x faster I/O, 30-minute encodes vs 5+ hours

### 2. Hardware Acceleration

**GPU Detection:**

```typescript
// apps/backend/src/nodes/utils/hardware-detection.ts

async detectHardwareAcceleration(): Promise<string> {
  // NVIDIA NVENC
  if (fs.existsSync('/proc/driver/nvidia/version')) {
    return 'NVENC';
  }

  // Intel QuickSync
  if (fs.existsSync('/dev/dri/renderD128')) {
    const output = execSync('vainfo').toString();
    if (output.includes('VAProfileH264')) {
      return 'QSV';
    }
  }

  // AMD AMF
  if (fs.existsSync('/dev/dri/renderD128')) {
    const output = execSync('rocm-smi').toString();
    if (output.includes('AMD')) {
      return 'AMF';
    }
  }

  // Apple Silicon
  if (process.arch === 'arm64' && process.platform === 'darwin') {
    return 'M_SERIES';
  }

  return 'CPU';
}
```

**Encoder Selection:**

```typescript
private getEncoder(codec: string, hwAccel: string): string {
  const encoders = {
    HEVC: {
      NVENC: 'hevc_nvenc',
      QSV: 'hevc_qsv',
      AMF: 'hevc_amf',
      M_SERIES: 'hevc_videotoolbox',
      CPU: 'libx265'
    },
    H264: {
      NVENC: 'h264_nvenc',
      QSV: 'h264_qsv',
      AMF: 'h264_amf',
      M_SERIES: 'h264_videotoolbox',
      CPU: 'libx264'
    }
  };

  return encoders[codec][hwAccel];
}
```

### 3. Database Indexing

**Optimized Queries:**

```prisma
// prisma/schema.prisma

model EncodingJob {
  // ... fields ...

  @@index([stage, priority])          // Query jobs by stage + priority
  @@index([nodeId, stage])            // Query jobs by node + stage
  @@index([libraryId, stage])         // Query jobs by library + stage
  @@index([createdAt])                // Order by created date
  @@index([completedAt])              // Query completed jobs
}
```

### 4. Concurrent Job Limits

**Prevent system overload:**

```typescript
// apps/backend/src/queue/queue.service.ts

const maxConcurrentJobs = this.configService.get<number>('MAX_CONCURRENT_JOBS', 2);

// Limit active jobs per node
const activeJobs = await this.prisma.encodingJob.count({
  where: {
    nodeId: node.id,
    stage: 'ENCODING'
  }
});

if (activeJobs >= maxConcurrentJobs) {
  this.logger.warn(`Node ${node.name} at max capacity (${activeJobs}/${maxConcurrentJobs})`);
  return;  // Don't assign more jobs
}
```

---

## Design Decisions

### Why NestJS?

- **TypeScript-first** - Type safety across entire stack
- **Modular architecture** - Clean separation of concerns
- **Dependency injection** - Testable, maintainable code
- **Built-in WebSocket** - Real-time updates out of box
- **Excellent documentation** - Large community, enterprise-ready

### Why Angular 20 (Standalone)?

- **Standalone components** - Simpler, less boilerplate
- **Signals** - Reactive primitives for performance
- **Built-in control flow** - @if, @for instead of structural directives
- **Nx integration** - Monorepo tooling, incremental builds
- **Enterprise-grade** - Used by Google, battle-tested

### Why Prisma ORM?

- **Type-safe queries** - Auto-generated TypeScript types
- **Migrations** - Schema versioning, safe rollbacks
- **Multi-database** - SQLite (free) → PostgreSQL (commercial)
- **Performance** - Query optimization, connection pooling
- **Developer experience** - Prisma Studio for debugging

### Why SQLite for Free Tier?

- **Zero configuration** - Works out of box
- **Single file** - Easy backups
- **No dependencies** - No separate database server
- **Sufficient for single node** - Handles 1000s of jobs
- **Upgrade path** - Migrate to PostgreSQL for commercial

### Why mDNS for Discovery?

- **Zero configuration** - Works on home networks
- **User-friendly** - No manual IP entry
- **Fallback available** - Manual pairing for complex networks
- **Standard protocol** - Bonjour/Avahi compatible
- **Local network only** - Security by default

---

## Next Steps

- **[Deployment Guide](./deployment.md)** - Build and deployment processes
- **[Feature Documentation](./features/)** - Detailed feature specs
- **[Contributing](../../CONTRIBUTING.md)** - Contribution guidelines

---

<div align="center">

**Understanding the architecture? Start contributing!**

[Docs Home](../README.md) • [Getting Started](../user/getting-started.md) • [Deployment](./deployment.md)

</div>
