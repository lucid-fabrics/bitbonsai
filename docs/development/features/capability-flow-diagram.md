# Hybrid Multi-Node Architecture - Complete Flow Diagram

## Child Node Setup Flow (End-to-End)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CHILD NODE SETUP WIZARD                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌────────────────┐
│  STEP 1        │
│  Welcome       │    User opens: http://192.168.1.61:3000/node-setup
│                │
│  🌐 Connect to │    • Welcome screen with feature highlights
│  Main Node     │    • "Get Started" button
│                │
└────────┬───────┘
         │
         ▼
┌────────────────┐
│  STEP 2        │
│  Choose Method │    User chooses connection method
│                │
│  ⚡ Auto        │    Option 1: Auto-Discovery (mDNS scan)
│  🔤 Manual      │    Option 2: Manual pairing code
│                │
└────────┬───────┘
         │
         ▼
┌────────────────┐
│  STEP 3        │
│  Scanning      │    Animated network scan (5 seconds)
│                │
│  🔍 Scanning   │    • Broadcasts mDNS query
│  Network...    │    • Listens for main node responses
│                │    • Displays discovered nodes
│  ▓▓▓▓▓▓▓░░░░   │
└────────┬───────┘
         │
         ▼
┌────────────────┐
│  STEP 4        │
│  Select Node   │    User selects main node and enters name
│                │
│  📡 Main Node  │    • Shows: "BitBonsai Main (192.168.1.100)"
│  192.168.1.100 │    • Input: Child node name ("LXC Child 1")
│                │    • Button: "Request Connection"
│  Name: _______ │
└────────┬───────┘
         │
         ▼
┌────────────────┐
│  STEP 5        │
│  Pairing       │    Sends request to main node, waits for approval
│                │
│  ⏳ Waiting    │    • Shows 6-digit pairing code: "123456"
│  Code: 123456  │    • Polls main node every 2 seconds
│                │    • Elapsed time: 0:15
│  Elapsed: 0:15 │    • Status: "Waiting for approval..."
└────────┬───────┘
         │
         │  ┌──────────────────────────────────────────────────────────┐
         │  │         MAIN NODE APPROVAL (Parallel)                    │
         │  │  http://192.168.1.100:4210/pending-requests             │
         │  │                                                          │
         │  │  🔔 Pending Requests (1)                                │
         │  │                                                          │
         │  │  ┌────────────────────────────────────────────────┐    │
         │  │  │ LXC Child 1                              PENDING │    │
         │  │  │ IP: 192.168.1.61                               │    │
         │  │  │ Hostname: lxc-bitbonsai                        │    │
         │  │  │ Hardware: 12 cores, 32GB RAM                   │    │
         │  │  │                                                 │    │
         │  │  │ [Approve] [Reject]                             │    │
         │  │  └────────────────────────────────────────────────┘    │
         │  │                                                          │
         │  │  Admin clicks [Approve]                                 │
         │  │                                                          │
         │  │  Backend runs:                                          │
         │  │  1. NodeCapabilityDetectorService.detectCapabilities()  │
         │  │  2. Creates Node with detected capabilities             │
         │  │  3. Updates request status to APPROVED                  │
         │  │  4. Returns childNodeId in response                     │
         │  └──────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────┐
│  STEP 6        │    ✨ NEW: Capability Testing (Animated)
│  Testing       │
│  Capabilities  │    Automatically runs after approval
│                │
│  Progress:     │    Phase 1: Network Connection (0-25%)
│  ████████░░░░  │    ├─ Measure latency (ping)
│  75%           │    ├─ Detect private vs public IP
│                │    └─ ✅ Success: "Latency: 3ms"
│  Tests:        │
│  ✅ Network    │    Phase 2: Shared Storage (25-50%)
│  ✅ Storage    │    ├─ Test access to MEDIA_PATHS
│  ✅ Hardware   │    ├─ List directory contents
│  🔵 Network    │    └─ ✅ Success: "Accessible at /mnt/media"
│                │
└────────┬───────┘    Phase 3: Hardware Detection (50-75%)
         │            ├─ Read from registration request
         │            ├─ Extract CPU cores, RAM
         │            └─ ✅ Success: "12 cores, 32GB RAM"
         │
         │            Phase 4: Network Classification (75-100%)
         │            ├─ Combine IP type + latency
         │            ├─ Determine LOCAL vs REMOTE
         │            └─ ✅ Success: "Classified as LOCAL"
         │
         ▼
┌────────────────────────────────────────────────────────────────┐
│  STEP 7                                                        │
│  Capability Results (LOCAL High-Speed)                        │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐    │
│  │   🚀 OPTIMIZED SETUP                                 │    │
│  │   Local High-Speed Node                              │    │
│  │   Optimal configuration for maximum performance      │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                                │
│  Capabilities Detected:                                       │
│  ┌──────────┬──────────┬──────────┬──────────┐              │
│  │ Network  │ Storage  │ Latency  │ IP Type  │              │
│  │ LOCAL    │ Enabled  │ 3ms      │ Private  │              │
│  │          │ /mnt/    │          │          │              │
│  └──────────┴──────────┴──────────┴──────────┘              │
│                                                                │
│  💡 Configuration Analysis:                                   │
│     Local network node (private IP: yes, latency: 3ms).      │
│     Direct shared storage access enabled - jobs will use     │
│     zero-copy file access (optimal performance).             │
│                                                                │
│  ⚙️ Node Configuration:                                       │
│     Max Concurrent Jobs: [2]                                  │
│     CPU Limit (%):      [80]                                  │
│                                                                │
│  ✅ Zero-Copy Encoding Enabled                                │
│     This node can access files directly from the main        │
│     node's storage. No file transfers required!              │
│                                                                │
│  [Back]  [Complete Setup]                                     │
└────────────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────┐
│  STEP 8        │    Setup Complete!
│  Complete      │
│                │    • Fetches hardware detection
│  ✅ Success!   │    • Shows hardware summary
│                │    • "Start Encoding" button
│  Connected to  │
│  Main Node     │    Navigates to /queue page
│                │
│  🚀 Start      │
│  Encoding      │
└────────────────┘
```

---

## Alternative Flow: REMOTE Node

```
┌────────────────────────────────────────────────────────────────┐
│  STEP 7 (Alternative)                                          │
│  Capability Results (REMOTE Node)                             │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐    │
│  │   🌐 REMOTE SETUP DETECTED                           │    │
│  │   Remote Network Node                                │    │
│  │   File transfers will be required for encoding jobs  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                                │
│  Capabilities Detected:                                       │
│  ┌──────────┬──────────┬──────────┬──────────┐              │
│  │ Network  │ Storage  │ Latency  │ IP Type  │              │
│  │ REMOTE   │ Disabled │ 85ms     │ Public   │              │
│  │          │          │          │          │              │
│  └──────────┴──────────┴──────────┴──────────┘              │
│                                                                │
│  💡 Configuration Analysis:                                   │
│     Remote network node (public IP, latency: 85ms).          │
│     No shared storage access - jobs will require file        │
│     transfers (slower but works everywhere).                 │
│                                                                │
│  ⚠️ Remote Node Performance Notice                            │
│     • Estimated transfer time for 10GB file: 15-30 minutes   │
│     • Consider using VPN or shared storage for better perf   │
│     • Jobs will be routed to local nodes when available      │
│                                                                │
│  ⚙️ Node Configuration:                                       │
│     Max Concurrent Jobs: [1]                                  │
│     CPU Limit (%):      [80]                                  │
│                                                                │
│  [Back]  [Complete Setup]                                     │
└────────────────────────────────────────────────────────────────┘
```

---

## Backend Capability Detection Logic

```
┌─────────────────────────────────────────────────────────────────┐
│         NodeCapabilityDetectorService.detectCapabilities()      │
└─────────────────────────────────────────────────────────────────┘

Input: nodeId, nodeIp (from registration request)

┌───────────────┐
│ Step 1:       │
│ IP Range      │    Check if IP is in private range (RFC1918)
│ Detection     │    ├─ 10.0.0.0/8
│               │    ├─ 172.16.0.0/12
└───────┬───────┘    └─ 192.168.0.0/16
        │
        ▼
┌───────────────┐
│ Step 2:       │    Execute ping command:
│ Latency Test  │    • Linux/macOS: ping -c 3 <ip>
│               │    • Windows: ping -n 3 <ip>
└───────┬───────┘    • Parse average latency from output
        │
        ▼
┌───────────────┐
│ Step 3:       │    Decision tree:
│ Network Loc   │    ├─ Private IP + Latency < 50ms → LOCAL
│ Classification│    ├─ Private IP + Latency >= 50ms → LOCAL (slow VPN)
│               │    └─ Public IP → REMOTE
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ Step 4:       │    For LOCAL nodes only:
│ Storage Test  │    • Get MEDIA_PATHS from environment
│ (LOCAL only)  │    • Try fs.access() + fs.readdir()
│               │    • Success → hasSharedStorage = true
└───────┬───────┘    • Failure → hasSharedStorage = false
        │
        ▼
┌───────────────┐
│ Step 5:       │    Build CapabilityTestResult:
│ Generate      │    • networkLocation
│ Result        │    • hasSharedStorage
│               │    • latencyMs
└───────┬───────┘    • reasoning (human-readable)
        │
        ▼
    Return

Example Results:
┌──────────────────────────────────────────────────────────┐
│ LOCAL + Shared Storage:                                  │
│ {                                                         │
│   "networkLocation": "LOCAL",                             │
│   "hasSharedStorage": true,                               │
│   "storageBasePath": "/mnt/media",                        │
│   "latencyMs": 3,                                         │
│   "isPrivateIP": true,                                    │
│   "reasoning": "Local network node (private IP: yes,      │
│                 latency: 3ms). Direct shared storage      │
│                 access enabled - zero-copy (optimal)"     │
│ }                                                         │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ REMOTE:                                                   │
│ {                                                         │
│   "networkLocation": "REMOTE",                            │
│   "hasSharedStorage": false,                              │
│   "storageBasePath": null,                                │
│   "latencyMs": 85,                                        │
│   "isPrivateIP": false,                                   │
│   "reasoning": "Remote network node (public IP,           │
│                 latency: 85ms). No shared storage -       │
│                 jobs will require file transfers"         │
│ }                                                         │
└──────────────────────────────────────────────────────────┘
```

---

## Job Routing Algorithm (Phase 1, Already Complete)

```
┌─────────────────────────────────────────────────────────────────┐
│         JobRouterService.findBestNodeForJob()                   │
└─────────────────────────────────────────────────────────────────┘

Input: jobId, fileSizeBytes

┌───────────────┐
│ Step 1:       │    Fetch all ONLINE nodes with:
│ Fetch Nodes   │    • Capabilities (networkLocation, hasSharedStorage)
│               │    • Load (_count.jobs where stage IN [QUEUED, ENCODING])
└───────┬───────┘    • Hardware (cpuCores, ramGB)
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│ Step 2: Score Each Node                                       │
│                                                                │
│  Base Score (Network + Storage):                              │
│  ├─ LOCAL + Shared Storage:  1000 points (optimal)           │
│  ├─ LOCAL + No Storage:       500 points (good)              │
│  └─ REMOTE:                   100 points (fallback)          │
│                                                                │
│  Load Penalty:                                                │
│  ├─ Active Jobs / Max Workers = Load %                       │
│  ├─ Penalty = Load % × 2 (2 points per 1% load)             │
│  └─ Example: 2/4 jobs = 50% load = -100 points              │
│                                                                │
│  Large File + Remote Penalty:                                 │
│  ├─ If fileSize > 10GB AND networkLocation = REMOTE          │
│  └─ Penalty: -300 points (transfer too slow)                 │
│                                                                │
│  Capacity Check:                                              │
│  ├─ canHandle = false if:                                     │
│  │   • activeJobs >= maxWorkers                              │
│  │   • fileSizeMB > maxTransferSizeMB                        │
│  └─ Node excluded from selection if canHandle = false        │
│                                                                │
└───────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────┐
│ Step 3:       │    Example Scenario: 10GB file, 3 nodes
│ Sort & Select │
│               │    ┌─────────┬──────────┬──────┬───────┬──────┐
└───────┬───────┘    │ Node    │ Type     │ Load │ Score │ Win? │
        │            ├─────────┼──────────┼──────┼───────┼──────┤
        ▼            │ Node A  │ LOCAL+S  │ 2/4  │ 900   │ ✅   │
                     │ Node B  │ LOCAL    │ 1/4  │ 450   │ ❌   │
    Return           │ Node C  │ REMOTE   │ 0/4  │ -200  │ ❌   │
    Best Node        └─────────┴──────────┴──────┴───────┴──────┘

                     Node A wins: Highest score despite higher load
```

---

## Data Flow: Registration → Approval → Capability Test → Setup

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       DATA FLOW DIAGRAM                                   │
└──────────────────────────────────────────────────────────────────────────┘

Child Node                Main Node Backend              Main Node Frontend
──────────                ─────────────────              ──────────────────

POST /registration-requests
  {
    mainNodeId: "xyz",
    childNodeName: "LXC Child 1"
  }
    ┆
    ┆──────────────────────►  RegistrationRequestService
    ┆                           .createRegistrationRequest()
    ┆                           │
    ┆                           ├─ Collect system info (IP, MAC, hardware)
    ┆                           ├─ Generate 6-digit pairing token
    ┆                           ├─ Set 24h TTL
    ┆                           └─ INSERT INTO NodeRegistrationRequest
    ┆
    ◄──────────────────────┆  Response:
                           ┆    {
GET /registration-         ┆      id: "req123",
  requests/req123          ┆      pairingToken: "123456",
  (polling every 2s)       ┆      status: "PENDING"
    ┆                      ┆    }
    ┆                      ┆
    ┆                      ┆                                   Admin opens:
    ┆                      ┆                                   /pending-requests
    ┆                      ┆                                        │
    ┆                      ┆  GET /registration-requests/pending ◄──┘
    ┆                      ┆                                        │
    ┆                      ┆  Response: [{ id, childNodeName, ... }]
    ┆                      ┆                                        │
    ┆                      ┆  POST /registration-requests/          │
    ┆                      ┆       req123/approve ◄─────────────────┘
    ┆                      ┆       { maxWorkers: 2, cpuLimit: 80 }
    ┆                      ┆
    ┆                      ┆  RegistrationRequestService
    ┆                      ┆    .approveRequest()
    ┆                      ┆    │
    ┆                      ┆    ├─ NodeCapabilityDetectorService
    ┆                      ┆    │   .detectCapabilities(req.id, req.ipAddress)
    ┆                      ┆    │   │
    ┆                      ┆    │   ├─ Check private IP (192.168.1.61)
    ┆                      ┆    │   ├─ Ping test (3ms latency)
    ┆                      ┆    │   ├─ Test storage access (/mnt/media)
    ┆                      ┆    │   └─ Classify as LOCAL + Shared Storage
    ┆                      ┆    │
    ┆                      ┆    ├─ CREATE Node {
    ┆                      ┆    │     networkLocation: LOCAL,
    ┆                      ┆    │     hasSharedStorage: true,
    ┆                      ┆    │     storageBasePath: /mnt/media,
    ┆                      ┆    │     latencyMs: 3,
    ┆                      ┆    │     cpuCores: 12,
    ┆                      ┆    │     ramGB: 32
    ┆                      ┆    │   }
    ┆                      ┆    │
    ┆                      ┆    └─ UPDATE request { status: APPROVED,
    ┆                      ┆                         childNodeId: "node123" }
    ┆                      ┆
    ◄──────────────────────┆  Response:
Polling detects          ┆    {
status = APPROVED        ┆      status: "APPROVED",
    ┆                      ┆      childNodeId: "node123",
    ┆                      ┆      apiKey: "bb_xxx...",
    ┆                      ┆      mainNode: { id, name, version }
    ┆                      ┆    }
    ┆
    └─► DiscoveryService.completeSetup()
         • Save apiKey to localStorage
         • Mark backend setup as complete
         • Set approvedNodeId signal
         • Transition to CapabilityTest step

POST /nodes/node123/
     test-capabilities
    ┆
    ┆──────────────────────►  NodesController.testNodeCapabilities()
    ┆                           │
    ┆                           ├─ Fetch node from DB
    ┆                           ├─ Call NodeCapabilityDetectorService
    ┆                           ├─ Build test results object
    ┆                           └─ Return with "tests" phases
    ┆
    ◄──────────────────────┆  Response:
Capability test          ┆    {
complete                 ┆      networkLocation: "LOCAL",
    ┆                      ┆      hasSharedStorage: true,
    ┆                      ┆      tests: {
    ┆                      ┆        networkConnection: { status: "success", ... },
    ┆                      ┆        sharedStorage: { status: "success", ... },
    ┆                      ┆        hardwareDetection: { status: "success", ... },
    ┆                      ┆        networkType: { status: "success", ... }
    ┆                      ┆      }
    ┆                      ┆    }
    ┆
    └─► Display CapabilityResultsComponent
         • Parse results
         • Show GREEN banner (LOCAL + Shared)
         • Allow config editing
         • Complete setup
```

---

## Visual State Machine: Wizard Steps

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     NODE SETUP WIZARD STATE MACHINE                      │
└─────────────────────────────────────────────────────────────────────────┘

                        [START]
                           │
                           ▼
                    ┌──────────────┐
                    │   Welcome    │ Step 0
                    │ (WizardStep. │
                    │   Welcome)   │
                    └──────┬───────┘
                           │ [Get Started]
                           ▼
                    ┌──────────────┐
                    │ Choose Method│ Step 1
                    │ (WizardStep. │
                    │ ChooseMethod)│
                    └──────┬───────┘
                           │
                ┌──────────┴──────────┐
                │                     │
        [Auto-Discovery]      [Manual Code]
                │                     │
                ▼                     ▼
        ┌──────────────┐      ┌──────────────┐
        │   Scanning   │      │ Manual Code  │ Step 2/3
        │ (WizardStep. │      │ (WizardStep. │
        │   Scanning)  │      │ ManualCode)  │
        └──────┬───────┘      └──────┬───────┘
               │                     │
               └──────────┬──────────┘
                          ▼
                   ┌──────────────┐
                   │ Select Node  │ Step 4
                   │ (WizardStep. │
                   │ SelectNode)  │
                   └──────┬───────┘
                          │ [Request Connection]
                          ▼
                   ┌──────────────┐
                   │   Pairing    │ Step 5
                   │ (WizardStep. │   Poll every 2s
                   │   Pairing)   │   └─► GET /registration-requests/:id
                   └──────┬───────┘
                          │
                          │ [Approval detected]
                          │ status = APPROVED
                          │ childNodeId received
                          │
                          ▼
                 ┌──────────────────┐
                 │ Capability Test  │ Step 6 ✨ NEW
                 │ (WizardStep.     │
                 │ CapabilityTest)  │  Auto-starts after approval
                 └──────┬───────────┘  Animated 4-phase test
                        │
                        │ [Test complete]
                        │ results emitted
                        │
                        ▼
              ┌─────────────────────┐
              │ Capability Results  │ Step 7 ✨ NEW
              │ (WizardStep.        │
              │ CapabilityResults)  │  Shows results + config
              └──────┬──────────────┘
                     │ [Complete Setup]
                     │ config saved
                     │
                     ▼
              ┌──────────────┐
              │   Complete   │ Step 8
              │ (WizardStep. │
              │   Complete)  │  Hardware summary
              └──────┬───────┘
                     │ [Start Encoding]
                     │
                     ▼
                  [/queue]

State Transitions:
• Welcome → ChooseMethod: User clicks "Get Started"
• ChooseMethod → Scanning: User clicks "Auto-Discover"
• ChooseMethod → ManualCode: User clicks "Manual Code Entry"
• Scanning → SelectNode: Nodes discovered (auto-advance after 1s)
• ManualCode → SelectNode: User enters code and URL
• SelectNode → Pairing: User enters name and clicks "Request Connection"
• Pairing → CapabilityTest: ✨ Approval detected (NEW)
• CapabilityTest → CapabilityResults: ✨ Test complete (NEW)
• CapabilityResults → Complete: ✨ User clicks "Complete Setup" (NEW)
• Complete → /queue: User clicks "Start Encoding"

Error Paths:
• Any step → Error: Display error message, allow retry
• Pairing → Timeout: After 2 minutes, show timeout message
• Pairing → Rejected: Show rejection reason
```

---

**Diagram Version**: 1.0.0
**Last Updated**: November 10, 2025
**Architecture**: Hybrid Multi-Node with Capability Detection
