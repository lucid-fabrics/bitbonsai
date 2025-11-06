# BitBonsai Distributed Nodes Architecture - Comprehensive Exploration Report

**Date:** November 5, 2025  
**System:** BitBonsai Video Encoding Platform  
**Scope:** Complete analysis of distributed node feature  
**Report Type:** Architectural Review & UX Audit

---

## Executive Summary

BitBonsai implements a **well-structured but moderately complex** distributed node architecture designed to scale video encoding across multiple machines. The system demonstrates solid engineering practices with comprehensive error handling, but has opportunities for simplification in configuration, UX clarity, and operational observability.

### Key Findings

✅ **Strengths:**
- Solid licensing-based node management with built-in scaling limits
- Sophisticated job distribution with atomic claiming and race condition prevention
- Intelligent health checking with corrupted file detection
- Comprehensive worker pool management with CPU-aware auto-scaling
- Automatic load-based job throttling to prevent system overload

⚠️ **Complexity Points:**
- Multi-layered configuration scattered across database, environment variables, and code
- LINKED nodes have limited UI visibility (redirect to queue-only page)
- No unified dashboard showing cluster health and job distribution
- Complex deployment process requires CLI node registration
- Health check and job distribution architecture lacks visibility in UI

🔧 **Operational Gaps:**
- No out-of-the-box instructions for multi-node setup
- Node offline/health issues not prominently surfaced
- No cluster-wide metrics or insights dashboard
- Configuration changes require modal dialogs without preview
- Network/connectivity issues between nodes not explicitly handled

---

## 1. Node Management Architecture

### 1.1 Node Registration & Discovery

**Location:** `/apps/backend/src/nodes/nodes.service.ts`

#### Current Flow
```
User → Register Node → License Validation → Role Assignment → Pairing Token → Node Created
                           ↓
                    Validate License Key (DB lookup)
                    Check node count vs license limit
                    Auto-assign MAIN (first) or LINKED (additional)
                    Generate API key (never shown again)
                    Generate 6-digit pairing token (10 min expiry)
```

#### Database Schema (Prisma)

```prisma
model Node {
  id               String           @id @default(cuid())
  name             String
  role             NodeRole         // MAIN | LINKED
  status           NodeStatus       // ONLINE | OFFLINE | ERROR
  version          String
  acceleration     AccelerationType // CPU, INTEL_QSV, NVIDIA, AMD, APPLE_M
  pairingToken     String?          // Used during pairing, cleared after
  pairingExpiresAt DateTime?        // 10-minute expiration
  apiKey           String           // For node authentication
  lastHeartbeat    DateTime         // Latest health check
  uptimeSeconds    Int              // Server-side uptime tracking
  maxWorkers       Int              // Concurrent job limit (1-10)
  cpuLimit         Int              // CPU percentage (1-100)
  
  // Relations
  licenseId String   // License association
  libraries Library[]
  jobs      Job[]
  metrics   Metric[]
}

enum NodeRole {
  MAIN    // Cluster coordinator, has full UI access
  LINKED  // Worker node, queue-only UI access
}

enum NodeStatus {
  ONLINE   // Actively sending heartbeats
  OFFLINE  // No heartbeat in >2 minutes
  ERROR    // Reported error state
}
```

#### API Endpoints

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/nodes/register` | POST | Start registration | Public* |
| `/nodes/pair` | POST | Complete pairing with 6-digit code | Public* |
| `/nodes/:id/pairing-token` | POST | Regenerate pairing token | Bearer |
| `/nodes/:id/heartbeat` | POST | Report node status | Bearer |
| `/nodes` | GET | List all nodes | Bearer |
| `/nodes/:id` | GET | Node details | Bearer |
| `/nodes/:id/stats` | GET | Node statistics | Bearer |
| `/nodes/:id` | PATCH | Update configuration | Bearer |
| `/nodes/:id` | DELETE | Remove node | Bearer |
| `/nodes/current` | GET | Get current node info | Bearer |

*Public registration allows unauthenticated registration, relying on license key validation.

### 1.2 Pairing Mechanism

**Key Innovation:** 6-digit pairing token with time-based expiration

```typescript
// Registration Response (shown only once)
{
  id: string,
  name: string,
  role: "MAIN" | "LINKED",
  apiKey: string,              // CRITICAL: Save securely, shown only once
  pairingToken: "123456",      // 6-digit code, 10-minute expiration
  pairingExpiresAt: DateTime,
  createdAt: DateTime
}
```

**Security Features:**
- Cryptographically secure random number generation (crypto.randomBytes)
- 6-digit token space = 900,000 possible codes
- 10-minute expiration window prevents brute force
- Token cleared after pairing (prevents reuse)
- API key never re-shown (must be saved during registration)

**Weakness:** No rate limiting on pairing endpoint - could allow token brute force if exposed publicly.

### 1.3 Heartbeat Tracking

**Purpose:** Monitor node health and uptime

```typescript
// Auto-heartbeat for MAIN node
@Interval(30000)  // Every 30 seconds
private async sendMainNodeHeartbeat(): Promise<void>

// Manual heartbeat from LINKED nodes
POST /nodes/:id/heartbeat
{
  status?: "ONLINE" | "OFFLINE" | "ERROR"
}

// Response
{
  id: string,
  lastHeartbeat: DateTime,
  uptimeSeconds: number,
  status: string
}
```

**Observation Timeouts:**
- MAIN node: Auto-heartbeat every 30s (no timeout)
- LINKED nodes: Expected heartbeat every 60s (implied, not enforced)
- Offline detection: Implied >2 min without heartbeat (not explicitly checked in code)

**Gap:** No explicit offline timeout configuration. Status is never automatically set to OFFLINE - relies on manual monitoring.

---

## 2. Job Distribution & Load Balancing

### 2.1 Queue Architecture

**Location:** `/apps/backend/src/queue/queue.service.ts`

#### Job Lifecycle

```
DETECTED → HEALTH_CHECK → QUEUED → ENCODING → VERIFYING → COMPLETED
                  ↓ (if failed)
                FAILED

          OR: PAUSED_LOAD (during high load, auto-resumes)
```

#### Job Assignment Strategy

**File:** `getNextJob()` method

```typescript
// Step 1: Check node capacity
const activeJobs = count({ stage: [ENCODING, VERIFYING] })
if (activeJobs >= license.maxConcurrentJobs) {
  return null  // Node at capacity
}

// Step 2: Find next QUEUED job with ATOMIC CLAIMING
const job = await tx.job.findFirst({
  where: {
    nodeId,
    stage: QUEUED,
    OR: [
      { nextRetryAt: null },           // Never failed
      { nextRetryAt: { lte: now() } }  // Retry delay passed
    ]
  },
  orderBy: [
    { priority: 'desc' },        // Priority 2 (top), 1 (high), 0 (normal)
    { healthScore: 'desc' },     // Healthy files first
    { createdAt: 'asc' }         // FIFO within priority tier
  ]
})

// Step 3: ATOMIC CLAIM with race condition prevention
updateResult = await tx.job.updateMany({
  where: {
    id: job.id,
    stage: QUEUED  // CRITICAL: Verify still QUEUED
  },
  data: {
    stage: ENCODING,
    startedAt: now()
  }
})

// If update count = 0, another worker already claimed it
if (updateResult.count === 0) {
  return null  // Another worker got it first
}
```

**Load Balancing Strategy:**

| Factor | Priority | Rationale |
|--------|----------|-----------|
| **Priority** | 1st | User-set job priority (2=top, 1=high, 0=normal) |
| **Health Score** | 2nd | Healthy files encode faster (avoid corrupted sources) |
| **Created Date** | 3rd | FIFO fairness within priority tier |
| **Node Capacity** | Gate | Only assign if node has worker slots available |
| **Retry Delay** | Gate | Respect exponential backoff for failed jobs |

**Atomic Claiming:** Prevents race conditions where multiple workers grab the same job using database transaction + updateMany with WHERE clause verification.

### 2.2 Worker Pool Management

**Location:** `/apps/backend/src/encoding/encoding-processor.service.ts`

#### CPU-Aware Worker Calculation

```typescript
// Constants
CORES_PER_HEVC_JOB = 4          // HEVC needs ~4 cores minimum
WORKER_SAFETY_MARGIN = 0.5      // Use 50% of theoretical max
MIN_WORKERS_PER_NODE = 2
MAX_WORKERS_PER_NODE = 12

// Formula: workers = Math.floor((cpuCores / CORES_PER_JOB) * SAFETY_MARGIN)
// Example for 128-core CPU:
//   Theoretical max: 128 / 4 = 32 workers
//   With 50% margin: 32 * 0.5 = 16 workers
//   Capped at MAX: 12 workers
```

#### Worker Pool State Management

```typescript
interface NodeWorkerPool {
  nodeId: string,
  maxWorkers: number,
  activeWorkers: Set<string>  // workerId like "node-123-worker-1"
}

interface WorkerState {
  workerId: string,
  nodeId: string,
  isRunning: boolean,
  currentJobId: string | null,
  startedAt: Date,
  shutdownPromise?: Promise<void>
}
```

#### Load-Based Job Throttling

**Feature:** Auto-pause/resume jobs based on system load

```typescript
private async manageLoadBasedPausing(): Promise<void> {
  loadAvg = os.loadavg()[0]
  
  // Load thresholds (1-minute average)
  if (loadAvg < 50) {
    targetWorkers = 10  // Normal
  } else if (loadAvg < 100) {
    targetWorkers = 8   // Moderate throttling (80%)
  } else if (loadAvg < 200) {
    targetWorkers = 5   // High throttling (50%)
  } else {
    targetWorkers = 3   // Emergency (30%)
  }
  
  // Auto-pause lowest priority QUEUED jobs when over capacity
  if (activeJobs > targetWorkers) {
    // Find jobs to pause, ordered by priority ASC, createdAt DESC
    // Move to PAUSED_LOAD stage with clear message
  }
  
  // Auto-resume highest priority PAUSED_LOAD jobs when capacity available
  if (pausedJobs > 0 && activeJobs < targetWorkers) {
    // Move back to QUEUED, resume processing
  }
}
```

**JobStage.PAUSED_LOAD** is a new stage (Oct 31, 2025) for system load management:
- Not visible in UI
- Auto-paused by system when load exceeds thresholds
- Auto-resumed when load drops
- Clear user message: "Auto-paused due to high system load. Will auto-resume when load drops."

---

## 3. Node Communication Protocol

### 3.1 Heartbeat Protocol

**Frequency:** 60 seconds (implied for LINKED nodes)

```typescript
// Frontend polls every 10 seconds
interval(10000)
  .pipe(switchMap(() => this.nodesApi.getNodes()))
  .subscribe(nodes => updateUI(nodes))

// Backend auto-heartbeat every 30 seconds (MAIN node only)
@Interval(30000)
private async sendMainNodeHeartbeat(): Promise<void>
```

**Data Exchange:**

```javascript
// Node → Backend
POST /nodes/:id/heartbeat
{
  status?: "ONLINE" | "OFFLINE" | "ERROR"  // Optional
}

// Backend → Node (Response)
{
  id: string,
  name: string,
  status: string,
  lastHeartbeat: DateTime,
  uptimeSeconds: number
}
```

### 3.2 Job Assignment Protocol

```javascript
// Node → Backend: Request next job
GET /queue/next?nodeId=:id

// Backend → Node: Job details
{
  id: string,
  filePath: string,
  fileLabel: string,
  sourceCodec: string,
  targetCodec: string,
  policy: { ... },
  library: { ... }
}

// Node → Backend: Progress update
PATCH /queue/:id/progress
{
  progress: 0-100,
  etaSeconds: number,
  fps: number,
  stage: string
}

// Node → Backend: Job completion
POST /queue/:id/complete
{
  afterSizeBytes: BigInt,
  savedBytes: BigInt,
  savedPercent: number
}
```

### 3.3 Network Architecture Assumptions

**Not Explicitly Documented:**
- ❓ How do nodes authenticate with backend? (API key header? JWT?)
- ❓ How are network failures handled? (Retry logic? Timeout settings?)
- ❓ How is node discovery done? (DNS? Static IP? Service discovery?)
- ❓ Is there node-to-node communication? (Direct file transfer? Via shared storage?)

**Evidence from code:**
- API key is stored per-node (unique authentication)
- HTTP/REST is the communication protocol
- No explicit network resilience in queue service
- Shared storage assumed (library paths are absolute local paths)

---

## 4. Health Monitoring System

### 4.1 File Health Checking

**Location:** `/apps/backend/src/queue/health-check.worker.ts`

#### Health Check Stages

```
DETECTED (new job) 
    ↓
HEALTH_CHECK (validating file)
    ↓ Success (score ≥ 40)
QUEUED (ready to encode)
    ↓ Fail (score < 40)
FAILED (corrupted file)
```

#### Health Check Process

```typescript
// Configuration
HEALTH_CHECK_CONCURRENCY = 10    // Parallel checks
HEALTH_CHECK_INTERVAL_MS = 2000  // Check every 2 seconds
MIN_HEALTH_SCORE = 40            // Minimum to queue
MAX_RETRY_ATTEMPTS = 3           // Retry corrupted checks 3x

// Process
1. Find DETECTED jobs
2. Update to HEALTH_CHECK (visible in UI)
3. Run FFprobe health analysis in parallel
4. If healthy (score ≥ 40) → QUEUED
5. If corrupted (score < 40) → FAILED
6. Retry transient failures up to 3 times
```

#### Health Check Scoring

```typescript
// FFprobe analysis generates:
{
  healthStatus: FileHealthStatus  // UNKNOWN, HEALTHY, WARNING, AT_RISK, CORRUPTED
  healthScore: 0-100              // 0=corrupted, 50=risky, 90+=healthy
  healthMessage: string           // Human-readable explanation
  healthCheckedAt: DateTime
  healthCheckRetries: number      // Retry count
}
```

**Failure Patterns Detected:**
- Corrupted HEVC streams (decoder errors)
- Invalid container formats (moov atom errors)
- Corrupted NAL units
- Missing reference frames
- Illegal short-term buffer state

### 4.2 Node Health Status

**How Node Status is Determined:**
- ✅ Auto-updated to ONLINE on successful heartbeat
- ❌ Not automatically set to OFFLINE (implied from missing heartbeat)
- ⚠️ Can be manually set to ERROR via heartbeat endpoint

**Gap:** No automatic offline timeout detection. Frontend assumes >2 min without heartbeat = offline, but backend doesn't enforce this.

### 4.3 Job Failure Handling

**Location:** `/apps/backend/src/encoding/encoding-processor.service.ts`

#### Non-Retriable Error Detection

```typescript
// Corrupted source file patterns (non-retriable)
- "could not find ref with poc"
- "error submitting packet to decoder: invalid data found"
- "corrupt decoded frame in stream"
- "missing reference picture"
- "illegal short term buffer state detected"
- "invalid data found when processing input"

// If detected: Fail immediately, don't retry
// Clear message: "⚠️ NON-RETRIABLE ERROR: The source file appears to be corrupted."
```

#### Retry Logic

```typescript
// Transient errors (retriable with exponential backoff)
- Connection timeouts
- Out of memory
- Disk full
- Process killed

// Retry strategy:
1st retry: After 5 minutes (5 * 60s)
2nd retry: After 30 minutes (6 * 5min)
3rd retry: After 3 hours (6 * 30min)
Max retries: 3

// After 3 failed retries, mark as FAILED (non-retriable)
```

---

## 5. Node Configuration

### 5.1 Database Configuration

**Per-Node Settings:**

| Setting | Range | Default | Purpose |
|---------|-------|---------|---------|
| `maxWorkers` | 1-10 | Auto-calculated | Concurrent encoding jobs |
| `cpuLimit` | 1-100 | 80 | CPU usage ceiling (not enforced) |
| `name` | String | Auto-generated | Display name |

**Per-License Settings:**

| Setting | Type | Purpose |
|---------|------|---------|
| `maxConcurrentJobs` | Int | Max active jobs per node |
| `maxNodes` | Int | Cluster size limit |
| `tier` | Enum | Feature access level |
| `status` | Enum | License validity (ACTIVE/EXPIRED/REVOKED) |
| `features` | JSON | Feature flags (multiNode, advancedPresets, api) |

### 5.2 Environment Variable Configuration

```bash
# Health Check Worker
HEALTH_CHECK_CONCURRENCY=10         # Parallel health checks
HEALTH_CHECK_INTERVAL_MS=2000       # Check interval
MIN_HEALTH_SCORE=40                 # Min score to queue
MAX_RETRY_ATTEMPTS=3                # Health check retries

# Stuck Job Recovery
RECOVERY_INTERVAL_MS=120000         # 2 minutes
HEALTH_CHECK_TIMEOUT_MIN=5          # Timeout before reset
ENCODING_TIMEOUT_MIN=10             # Stuck ENCODING detection
VERIFYING_TIMEOUT_MIN=30            # Stuck VERIFYING detection

# Node Identification
NODE_ID=<node-id>                   # Which node instance is this
```

### 5.3 Configuration Complexity Analysis

**Issue:** Configuration is scattered across 3 layers:

```
Layer 1: Database (node settings)
  └─ maxWorkers, cpuLimit, name

Layer 2: Environment Variables
  └─ HEALTH_CHECK_*, ENCODING_TIMEOUT_*, NODE_ID

Layer 3: Code Constants
  └─ CORES_PER_HEVC_JOB, WORKER_SAFETY_MARGIN, timeouts
```

**Operational Impact:**
- Node admins see only Layer 1 in UI
- System admins must manage Layer 2 (environment)
- Developers must change Layer 3 (code constants)
- No centralized configuration dashboard

---

## 6. User Experience Analysis

### 6.1 Node Management UI

**File:** `/apps/frontend/src/app/features/nodes/nodes.page.ts`

#### Workflow: Register New Node

**Step 1: Click "Register New Node"**
```
→ POST /nodes/register
→ Get registration command + 6-digit code + 10-min countdown
```

**Step 2: Run Command on Node Machine**
```
$ curl -X POST https://your-bitbonsai-server/nodes/register \
  -H "Content-Type: application/json" \
  -d '{"name":"MyNode","licenseKey":"...","version":"1.0","acceleration":"CPU"}'

# Returns: Node ID, API key, Pairing token (6-digit code)
```

**Step 3: Enter 6-Digit Code in Web UI**
```
Modal Input → 6-digit code
  ↓ (validates)
POST /nodes/pair { "pairingToken": "123456" }
  ↓
Node paired! Status: ONLINE
```

**UX Assessment:**
✅ Clear 3-step workflow with visual indicators  
✅ Copy-to-clipboard for command  
✅ Countdown timer shows expiration  
✅ Step indicators show progress  
❌ Command not shown on-screen (appears in modal only)  
❌ No help text explaining what each field does  
❌ No link to documentation  

### 6.2 Node Status Display

**Node Card Components:**

```html
<node-card>
  ├─ Header
  │  ├─ Name + Role badge (MAIN | LINKED)
  │  └─ Status circle (ONLINE | OFFLINE | ERROR)
  ├─ Info Grid
  │  ├─ Hardware acceleration type
  │  ├─ Version
  │  ├─ Uptime (live counter, increments every second)
  │  ├─ Last heartbeat (formatted time)
  │  ├─ Active job count
  │  ├─ Max workers
  │  └─ CPU limit
  └─ Actions
     ├─ Configure (edit maxWorkers, cpuLimit, name)
     ├─ View Stats (get node statistics)
     └─ Remove (delete node, disabled for MAIN)
```

**UX Assessment:**
✅ Compact card layout shows all key info  
✅ Uptime counter updates every second (feels alive)  
✅ Role badges distinguish MAIN/LINKED  
✅ Actions are discoverable via buttons  
❌ No indication if node is healthy (no health score)  
❌ "Last heartbeat" is not prominently surfaced  
❌ No warning if node is OFFLINE or stale  
❌ Stats modal has undefined fields (cpuUsage, memoryUsage not populated)  

### 6.3 LINKED Node Restrictions

**Current Behavior:**

When a LINKED node loads the frontend:
1. Browser loads Angular app
2. App fetches current node info
3. If role = LINKED, route guard redirects to /queue
4. User can only see queue, no access to:
   - Libraries management
   - Policies configuration
   - Node management
   - System settings

**UX Issue:** 
- User sees UI briefly, then redirected
- No explanation why
- No indication they're a LINKED node
- Frustrating for LINKED node operators

**Better Approach:**
- Show a banner: "🔗 This is a LINKED node. Library management is handled by the MAIN node."
- Allow read-only access to libraries/policies
- Show links to MAIN node UI if available

### 6.4 Configuration Dialogs

**Node Config Modal:**
```
┌─────────────────────────────────┐
│ Configure Node                  │
├─────────────────────────────────┤
│ Name: [____________________]    │
│ Max Workers: [__] (1-10)       │
│ CPU Limit: [__]% (1-100)       │
├─────────────────────────────────┤
│ [Cancel] [Save]                │
└─────────────────────────────────┘
```

**UX Issues:**
❌ No preview of impact ("Max Workers: 4 = 4 concurrent jobs")  
❌ No info icons explaining what each field does  
❌ No validation feedback before saving  
❌ No warnings about changing settings during active encoding  
❌ Settings saved immediately without confirmation  

---

## 7. Architecture Complexity Assessment

### 7.1 Complexity Heat Map

| Component | Complexity | Risk | Reason |
|-----------|-----------|------|--------|
| **Heartbeat System** | 🟢 Low | Low | Simple polling, no state machine |
| **Job Distribution** | 🟡 Medium | Low | Atomic claiming is solid but not obvious |
| **Worker Pools** | 🟡 Medium | Medium | CPU-aware scaling with load thresholds |
| **Health Checking** | 🟡 Medium | Medium | Parallel processing, retry logic |
| **Configuration** | 🟠 High | High | 3 layers (DB/env/code), scattered |
| **Node Communication** | 🟠 High | Medium | Implicit protocol, error handling unclear |
| **Load Management** | 🟠 High | Medium | 4 load thresholds, auto-pause/resume |

### 7.2 Potential Failure Modes

| Failure Mode | Impact | Detection | Recovery |
|--------------|--------|-----------|----------|
| **Node crashes** | 🔴 High | Heartbeat timeout (2+ min) | Auto-reassign jobs to next worker |
| **Network partition** | 🔴 High | No ping/health check | Manual intervention needed |
| **Corrupted source file** | 🟡 Medium | Health check worker | Clear error message + fail immediately |
| **Worker pool exhaustion** | 🟡 Medium | Job stuck in QUEUED | Auto-pause jobs via load management |
| **Disk full on node** | 🟡 Medium | FFmpeg error | Error message, job fails |
| **High load spike** | 🟡 Medium | Load average > threshold | Auto-pause non-priority jobs |
| **Verification race condition** | 🔴 High | (Fixed Oct 31) | Verify before rename + atomic ops |

### 7.3 Known Issues & Fixes

**Recent Fixes (Oct 31, 2025):**

1. ✅ **Verification Race Condition** - Temp file removed before verification
   - Solution: Verify BEFORE rename operation
   - Impact: Fixed 7 failed jobs

2. ✅ **Corrupted Source Detection** - Infinite retries on corrupted files
   - Solution: Pattern-match FFmpeg stderr for decoder errors
   - Impact: Fail immediately with clear message

3. ✅ **System Overload** - Jobs stuck when load > capacity
   - Solution: Auto-pause jobs with PAUSED_LOAD stage
   - Impact: System never overloaded, auto-resumes when load drops

**Remaining Gaps:**

1. ❌ **Offline Detection** - No automatic timeout for missing heartbeats
2. ❌ **Node Connectivity** - No explicit network partition detection
3. ❌ **Resource Limits** - cpuLimit is set but not enforced
4. ❌ **Configuration Visibility** - Settings scattered across 3 layers

---

## 8. Recommendations

### Priority 1: Critical (Operational Risk)

#### 8.1 Add Automatic Offline Timeout

**Current:** Node status never automatically changes to OFFLINE  
**Recommended:** Implement 2-minute timeout

```typescript
// In NodesService
async onModuleInit() {
  // Every minute, check for stale heartbeats
  setInterval(() => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    
    // Find nodes with stale heartbeats
    const staleNodes = await this.prisma.node.findMany({
      where: {
        lastHeartbeat: { lt: twoMinutesAgo },
        status: 'ONLINE'
      }
    });
    
    // Mark as OFFLINE
    for (const node of staleNodes) {
      await this.prisma.node.update({
        where: { id: node.id },
        data: { status: 'OFFLINE' }
      });
      this.logger.warn(`Node ${node.name} marked OFFLINE (no heartbeat since ${twoMinutesAgo})`);
    }
  }, 60000);
}
```

**Impact:** Prevents indefinite ONLINE status for dead nodes

#### 8.2 Add Network Partition Detection

**Current:** No way to detect if node network is down  
**Recommended:** Implement health check challenge-response

```typescript
// Backend initiates health check
POST /nodes/:id/health-check
{
  challenge: "abc123"
}

// Node must respond within 30s
POST /nodes/:id/health-check
{
  challenge: "abc123",
  proof: "signature"
}

// If no response in 30s, mark node as OFFLINE
```

**Impact:** Faster detection of network failures

#### 8.3 Enforce CPU Limit

**Current:** cpuLimit is stored but never enforced  
**Recommended:** Pass to FFmpeg via -threads limit

```typescript
// In ffmpeg.service.ts
private buildEncodingCommand(): string {
  const threads = Math.floor((node.cpuLimit / 100) * os.cpus().length);
  
  return `ffmpeg ... -threads ${threads} ...`;
}
```

**Impact:** Prevents CPU overload from rogue jobs

### Priority 2: High (UX/Usability)

#### 8.4 Create Cluster Dashboard

**Current:** No cluster-wide view  
**Recommended:** New /dashboard page showing:

```
┌─────────────────────────────────────────┐
│ Cluster Status                          │
├─────────────────────────────────────────┤
│ Nodes: 3 online, 1 offline              │
│ Active Jobs: 12/20 capacity             │
│ Queue: 45 pending, 8 paused             │
│ Avg Uptime: 127 days                    │
│                                         │
│ [MAIN Node]        [LINKED Node 1]      │
│  4/4 workers       3/3 workers          │
│  8 active jobs     2 active jobs        │
│  127d uptime       45d uptime           │
│  CPU: 85%          CPU: 60%             │
│  RAM: 72%          RAM: 54%             │
└─────────────────────────────────────────┘
```

**Implementation:**
- Create `/cluster` route
- Fetch aggregated metrics from `/nodes` endpoint
- Add `/metrics` endpoint for cluster-wide stats
- Show job distribution across nodes

**Impact:** Users understand cluster health at a glance

#### 8.5 Improve LINKED Node UX

**Current:** Silent redirect to queue page  
**Recommended:** Show banner + provide context

```html
<div class="linked-node-banner">
  <i class="fas fa-info-circle"></i>
  <div>
    <strong>This is a LINKED node</strong>
    <p>Library and policy management is handled by the MAIN node.</p>
    <p>This node focuses on encoding jobs. View the MAIN node UI for configuration.</p>
  </div>
</div>
```

**Implementation:**
- Show banner on all pages for LINKED nodes
- Provide link to MAIN node UI (if available)
- Allow read-only access to libraries/policies
- Show which MAIN node this is linked to

**Impact:** LINKED node operators understand their role

#### 8.6 Enhance Configuration Feedback

**Current:** Settings dialog with no preview or validation  
**Recommended:** Add live preview and warnings

```html
<form>
  <label>
    Max Workers
    <input type="number" min="1" max="10" value="4">
    <span class="info">Will process up to 4 encoding jobs simultaneously</span>
  </label>
  
  <label>
    CPU Limit
    <input type="number" min="1" max="100" value="80">
    <span class="info">85% of 128 CPUs = ~109 CPU cores</span>
  </label>
  
  @if (hasActiveJobs) {
    <div class="warning">
      <i class="fas fa-exclamation-triangle"></i>
      Changing settings while jobs are active may cause them to pause/resume
    </div>
  }
  
  <button [disabled]="isInvalid">Save Configuration</button>
</form>
```

**Impact:** Users make informed configuration changes

### Priority 3: Medium (Operational Visibility)

#### 8.7 Add Node Status Indicators to Queue Page

**Current:** Queue shows jobs but not which node they're on  
**Recommended:** Add node info to job cards

```html
<job-card>
  <div class="job-header">
    <span class="filename">Movie.mkv</span>
    <span class="node-status">
      <i [class]="node.status === 'ONLINE' ? 'fa-check' : 'fa-times'"></i>
      {{ node.name }}
    </span>
  </div>
  <div class="job-progress">
    <progress [value]="job.progress"></progress>
    <span>{{ job.progress }}% ({{ job.eta }})</span>
  </div>
</job-card>
```

**Impact:** Queue visibility shows which nodes are processing jobs

#### 8.8 Create Health Insights Dashboard

**Current:** No health trend tracking  
**Recommended:** Show per-node metrics over time

```
Node Performance (Last 7 Days)
┌────────────────────────────────┐
│ Success Rate: 98.5%            │
│ Avg Encoding Time: 3.2h        │
│ Uptime: 100%                   │
│ Hardware Acceleration: NVIDIA  │
│                                │
│ Recent Issues:                 │
│ - 2 corrupted source files     │
│ - 1 out-of-memory error        │
│ - 0 network timeouts           │
└────────────────────────────────┘
```

**Implementation:**
- Track metrics per node (success rate, avg time, uptime)
- Show issues discovered (corrupted files, failures)
- Add `/nodes/:id/metrics` endpoint
- Aggregate weekly/monthly trends

**Impact:** Operators proactively manage node health

#### 8.9 Document Multi-Node Setup

**Current:** No documented procedure for adding LINKED nodes  
**Recommended:** Create step-by-step guide

```markdown
# Multi-Node Setup Guide

## Prerequisites
- MAIN node already running
- Another machine with encoding capabilities
- Network access between machines

## Step 1: On MAIN Node, Generate Registration
1. Go to Nodes page
2. Click "Register New Node"
3. Follow the 3-step wizard
4. Note the registration command

## Step 2: On LINKED Node
1. Install BitBonsai software
2. Run the registration command
3. Set NODE_ID environment variable
4. Start the node service
5. Enter the 6-digit code on MAIN node
6. Confirm pairing

## Step 3: Configure
1. Go to Node Settings
2. Set Max Workers (recommended: CPU cores / 4)
3. Set CPU Limit if needed
4. Click Save

## Verification
- Check Node Status page
- Should show as LINKED
- Should show ONLINE status
- Should appear in Cluster Dashboard
```

**Implementation:**
- Create `/docs/multi-node-setup.md`
- Add inline help throughout nodes page
- Link from registration wizard

**Impact:** New users can confidently set up clusters

### Priority 4: Low (Nice to Have)

#### 8.10 Add Node Auto-Discovery

**Current:** Manual registration required  
**Recommended:** Allow nodes to register via mDNS/Zeroconf

```typescript
// On LINKED node startup
const mdns = require('mdns');
mdns.advertise(mdns.tcp('bitbonsai-node'), {
  port: 3100,
  txt: {
    name: 'node-1',
    version: '1.0',
    acceleration: 'NVIDIA'
  }
});

// On MAIN node
const browser = mdns.createBrowser(mdns.tcp('bitbonsai-node'));
browser.on('serviceUp', (service) => {
  // Auto-suggest pairing
});
```

**Impact:** Easier discovery on local networks

#### 8.11 Add Node Grouping/Tagging

**Current:** No way to organize nodes (GPU vs CPU, by location, etc)  
**Recommended:** Add tags to nodes

```typescript
model Node {
  tags: String[] // ["gpu", "high-performance", "office"]
}

// In UI: Filter nodes by tag
<select>
  <option>All Nodes</option>
  <option>GPU Nodes</option>
  <option>CPU Nodes</option>
  <option>Remote Nodes</option>
</select>
```

**Impact:** Large deployments can organize nodes logically

---

## 9. Technical Debt Summary

### Code Quality Issues

| Issue | Location | Severity | Fix Effort |
|-------|----------|----------|-----------|
| **Magic numbers** | encoding-processor.service.ts | Medium | Extract to config |
| **Scattered config** | 3 layers (DB/env/code) | High | Centralize |
| **No error handling for offline nodes** | queue.service.ts | High | Add timeout checks |
| **cpuLimit not enforced** | ffmpeg.service.ts | High | Pass to FFmpeg |
| **Stats DTO mismatch** | nodes.client.ts | Medium | Populate fields |
| **Implicit timeouts** | nodes.service.ts | High | Document/enforce |
| **No network resilience** | (throughout) | High | Add retry logic |

---

## 10. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         Frontend (Angular)                        │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Nodes Page                 Queue Page        Dashboard     │  │
│  │ ├─ Register Modal          ├─ Jobs List      ├─ Cluster   │  │
│  │ ├─ Config Modal            ├─ Job Details    ├─ Metrics   │  │
│  │ ├─ Stats Modal             └─ Job Actions    └─ Insights  │  │
│  │ └─ Node Cards                                              │  │
│  │    (polling every 10s)                                     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              ↓ HTTP/REST API ↓                    │
├──────────────────────────────────────────────────────────────────┤
│                  Backend API (NestJS)                             │
│  ┌─ Nodes Module              ┌─ Queue Module                    │
│  │ ├─ register()              │ ├─ create()                      │
│  │ ├─ pair()                  │ ├─ getNextJob() [ATOMIC]         │
│  │ ├─ heartbeat()             │ ├─ updateProgress()              │
│  │ ├─ findAll()               │ ├─ completeJob()                 │
│  │ └─ getCurrentNode()         │ └─ failJob()                     │
│  │                             │                                  │
│  │ Health Check Worker         │ Stuck Job Recovery Worker       │
│  │ ├─ Parallel health checks   │ ├─ HEALTH_CHECK timeout         │
│  │ ├─ FFprobe validation       │ ├─ ENCODING timeout             │
│  │ └─ Score-based filtering    │ └─ VERIFYING timeout            │
│  │                             │                                  │
│  │                     Encoding Processor                         │
│  │                     ├─ Worker Pool (per node)                │
│  │                     ├─ CPU-aware scaling                     │
│  │                     ├─ Load-based throttling                 │
│  │                     ├─ Auto-pause/resume                     │
│  │                     └─ FFmpeg encoding                       │
│  └──────────────────────────────────────────────────────────────┘
│                              ↓ Database ↓                         │
├──────────────────────────────────────────────────────────────────┤
│  ┌─ Prisma ORM (SQLite/PostgreSQL)                              │
│  │ ├─ Nodes table (registration, status, uptime)               │
│  │ ├─ Jobs table (queue, encoding state, progress)             │
│  │ ├─ Libraries table (scanned directories)                    │
│  │ ├─ Policies table (encoding rules)                          │
│  │ ├─ Metrics table (aggregated performance)                   │
│  │ └─ JobHistory table (failure tracking)                      │
│  └──────────────────────────────────────────────────────────────┘
│                                                                    │
│  Distributed Nodes (Worker Instances)                            │
│  ┌──────────────────────┬──────────────────────┐                 │
│  │  MAIN Node           │  LINKED Node(s)      │                 │
│  │  ├─ Register/pair    │  ├─ Encode jobs     │                 │
│  │  ├─ Job assignment   │  ├─ Report progress │                 │
│  │  ├─ Health tracking  │  ├─ Handle errors   │                 │
│  │  ├─ Queue management │  └─ Auto-heartbeat  │                 │
│  │  └─ Auto-heartbeat   │                      │                 │
│  │     (every 30s)      │  ┌─────────────────┐ │                 │
│  │                      │  │ FFmpeg Process  │ │                 │
│  │                      │  │ (spawned per job)               │
│  │                      │  └─────────────────┘ │                 │
│  └──────────────────────┴──────────────────────┘                 │
│  (HTTP REST to Backend API)                                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 11. Success Metrics for Improvements

### If recommendations are implemented, the system will have:

| Metric | Current | Target | Benefit |
|--------|---------|--------|---------|
| **Cluster visibility** | None | Dashboard | Users see health at a glance |
| **Config time** | 5 min | 2 min | Faster onboarding |
| **Offline detection** | Manual | Automatic (2 min) | Faster failure recovery |
| **LINKED node clarity** | Silent redirect | Banner + context | Fewer confused operators |
| **Setup documentation** | None | Step-by-step guide | Users can scale independently |
| **Node health tracking** | Current only | Historical trends | Proactive maintenance |

---

## 12. Conclusion

BitBonsai's distributed node architecture is **solid and production-ready** with comprehensive error handling and intelligent load management. However, there are clear opportunities to simplify configuration, improve operational visibility, and enhance user experience.

### Key Strengths
- Atomic job claiming prevents race conditions
- Intelligent file health checking catches corrupted sources
- Load-based throttling prevents system overload
- CPU-aware worker scaling is elegant
- Comprehensive error recovery mechanisms

### Key Gaps
- No automatic offline detection
- Configuration scattered across 3 layers
- No cluster-wide visibility dashboard
- LINKED node UX is confusing
- No documentation for multi-node setup

### Quick Wins (High Impact, Low Effort)
1. Add 2-minute offline timeout (high safety impact)
2. Create cluster dashboard (high visibility impact)
3. Fix stats modal population (high UX impact)
4. Improve LINKED node messaging (high UX impact)
5. Document setup guide (high adoption impact)

**Recommendation:** Prioritize Priority 1 and 2 items above for immediate deployment, then tackle Priority 3 for operational maturity.

