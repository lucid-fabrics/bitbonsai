# BitBonsai - Complete Application Product Requirements Document

## Executive Summary

BitBonsai is a distributed video encoding management system that automates the transcoding of video libraries across multiple compute nodes. It provides a centralized web interface for managing encoding policies, monitoring libraries, tracking job progress, and viewing system statistics.

## Product Vision

**Mission:** Simplify and automate video encoding at scale by distributing workloads across available compute resources while maintaining quality standards and maximizing storage efficiency.

**Target Users:** Home media server administrators, content managers, and IT professionals managing large video collections.

## System Architecture Overview

### Components
- **Frontend:** Angular 19+ Single Page Application (SPA)
- **Backend:** NestJS REST API with PostgreSQL database
- **Compute Nodes:** Distributed encoding workers (Proxmox VMs/LXCs)
- **File Watcher:** Real-time file system monitoring service
- **Job Queue:** Distributed job processing with FFmpeg encoding
- **License System:** Per-node licensing with activation keys

### Technology Stack
- **UI Framework:** Angular 19, Angular Material, NgRx for state management
- **API:** NestJS, Prisma ORM, PostgreSQL
- **Encoding:** FFmpeg with VAAPI hardware acceleration
- **Monitoring:** Real-time file watching with chokidar
- **Infrastructure:** Docker, Nx monorepo

---

## Core Features

## 1. Dashboard / Overview

### Purpose
Provide at-a-glance system health, encoding progress, and key metrics.

### Requirements

#### Summary Statistics Cards
- **Total Libraries** - Count of monitored libraries
- **Active Jobs** - Currently encoding files
- **Completed Jobs (24h)** - Jobs finished in last 24 hours
- **Failed Jobs (24h)** - Jobs that failed in last 24 hours
- **Total Storage Saved** - Cumulative space savings from encoding
- **Average Compression Ratio** - Percentage reduction across all jobs
- **Active Nodes** - Online nodes / total nodes
- **Total Policies** - Count of configured policies

#### Recent Jobs List
- Shows last 20 completed/failed jobs
- Columns:
  - **File Name** - Original video file name
  - **Library** - Which library the file belongs to
  - **Policy** - Encoding policy used
  - **Status** - Success, Failed, In Progress
  - **Duration** - How long encoding took
  - **Size Reduction** - Before/after file sizes
  - **Completed At** - Timestamp
- Sortable and filterable
- Click job row to view detailed logs

#### Active Encoding Jobs (Real-time)
- Live updating list of currently encoding files
- Shows:
  - File name and library
  - Progress percentage (0-100%)
  - Estimated time remaining
  - Current encoding speed (fps)
  - Node processing the job
- Progress bars with visual indicators
- Ability to cancel active jobs

#### System Health Indicators
- **Node Status** - Visual indicator for each node (online/offline/error)
- **Queue Depth** - Number of pending jobs waiting to start
- **Error Rate** - Percentage of failed jobs (last 24h)
- **Disk Space** - Available storage on each node
- **CPU/Memory Usage** - Resource utilization per node (if available)

#### Charts & Visualizations
- **Encoding Throughput** - Graph showing jobs completed over time (24h, 7d, 30d)
- **Storage Savings Trend** - Cumulative space saved over time
- **Error Rate Trend** - Failed jobs percentage over time
- **Jobs by Library** - Pie chart showing distribution

### User Workflows

#### Workflow: Monitor System Health
1. User logs into BitBonsai
2. Dashboard loads showing summary statistics
3. User sees 3 active jobs currently encoding
4. User notices 1 node offline (red indicator)
5. User clicks node to view details
6. User sees error: "Node connection timeout"
7. User troubleshoots node connectivity

#### Workflow: Review Recent Failures
1. User checks "Failed Jobs (24h)" card showing 5 failures
2. User scrolls to Recent Jobs list
3. User filters by "Failed" status
4. User clicks first failed job row
5. Job detail modal opens showing FFmpeg error logs
6. User identifies issue: "Codec not supported"
7. User updates policy to use compatible codec

### Error Scenarios
- **No Data Available:** Show skeleton loaders while fetching
- **API Error:** Show error toast, provide retry button
- **Stale Data:** Show last updated timestamp, auto-refresh every 30s

---

## 2. Libraries Management

### Purpose
Configure and monitor directories containing video files to be encoded.

### Requirements

#### Library List View
- Data table showing all libraries
- Columns:
  - **Name** - User-friendly library identifier
  - **Path** - Full filesystem path on node
  - **Node** - Compute node managing this library
  - **Policy** - Active encoding policy
  - **Status** - Active, Paused, Scanning, Error, Offline
  - **File Count** - Total video files detected
  - **Total Size** - Combined size of all files
  - **Last Scan** - Timestamp of most recent scan
  - **Actions** - Edit, Delete, Scan Now, View Files
- Search/filter by name, path, or node
- Sort by any column
- Pagination (25/50/100 per page)

#### Create Library
**Form Fields:**
- **Name** (required, unique, max 100 chars)
  - Example: "Movies - 4K HDR Collection"
- **Path** (required, must exist on node)
  - Path browser/selector component
  - Validates path exists before allowing save
  - Example: `/mnt/media/movies`
- **Node** (auto-assigned to first available)
  - Dropdown if multiple nodes available
  - Shows node name, status, and available disk space
- **Policy** (required)
  - Dropdown of all policies
  - Shows policy name and preset
  - Example: "4K HEVC Quality - QUALITY_HEVC"
- **Auto-scan on creation** (checkbox, default: true)
  - If checked, triggers immediate scan after creation

**Validation:**
- Name cannot be empty or duplicate
- Path must be absolute and exist on selected node
- Path must be a directory (not file)
- Node must be online and licensed
- Policy must be valid and active

**Behavior:**
- On success: Close dialog, trigger scan, show toast, refresh list
- On error: Show inline errors, keep dialog open
- Cancel discards changes without saving

#### Edit Library
- Same form as Create Library
- Pre-populated with current values
- Allow changing name, path, node, policy
- **Warning for policy change:** "Changing the policy will queue re-encoding for all X files in this library. Continue?"
- **Warning for path change:** "Changing the path will clear current file tracking. A new scan will be required."

#### Delete Library
- Confirmation dialog showing:
  - Library name and path
  - File count
  - Pending job count
  - Warning: "Files will not be deleted, only monitoring will stop"
  - Checkbox: "Also cancel X pending encoding jobs"
- On confirm: Delete library record, optionally cancel jobs, refresh list

#### Scan Library Now
- Manual trigger for immediate rescan
- Shows progress indicator during scan
- Updates file count and total size when complete
- Detects new files, modified files, deleted files
- Creates encoding jobs for new/modified files matching policy
- Toast notification: "Scan complete. Found X new files, queued Y encoding jobs"

#### View Library Files
- Opens modal showing all files in library
- File list table:
  - **File Name** - Video file name
  - **Size** - File size
  - **Codec** - Current video codec (detected)
  - **Resolution** - Video dimensions
  - **Duration** - Video length
  - **Status** - Not Encoded, Queued, Encoding, Completed, Failed
  - **Actions** - Encode Now, View Job, Skip
- Filter by status (All, Pending, Completed, Failed)
- Search by filename

#### Path Browser Component
- Modal dialog with directory tree
- Shows folders on selected node
- Expand/collapse navigation
- Breadcrumb showing current path
- "Go Up" button to navigate to parent
- "Select" button to confirm path
- Shows loading state while fetching
- Handles large directories (lazy loading)
- Error handling for permission denied, path not found

### API Endpoints
- `GET /api/libraries` - List all libraries
- `POST /api/libraries` - Create library (body: `{name, path, policyId}`)
- `GET /api/libraries/:id` - Get library details
- `PATCH /api/libraries/:id` - Update library
- `DELETE /api/libraries/:id` - Delete library
- `POST /api/libraries/:id/scan` - Trigger scan
- `GET /api/libraries/:id/files` - List files in library
- `GET /api/nodes/:id/browse?path=/foo/bar` - Browse filesystem

### User Workflows

#### Workflow: Create New Library
1. User navigates to Libraries page
2. Clicks "Create Library" button
3. Enters name: "Anime Collection"
4. Clicks "Browse" for path
5. Path browser opens showing node filesystem
6. User navigates to `/mnt/media/anime`
7. Clicks "Select"
8. Node auto-assigned (only 1 available)
9. Selects policy: "Anime HEVC - BALANCED_HEVC"
10. Leaves "Auto-scan" checked
11. Clicks "Save"
12. Library created, scan begins
13. Toast: "Library created. Scanning for files..."
14. After 30 seconds, scan completes
15. Library row shows: 245 files, 1.2 TB

#### Workflow: Change Library Policy
1. User finds library "TV Shows" in list
2. Clicks "Edit" action
3. Changes policy from "BALANCED_HEVC" to "QUALITY_HEVC"
4. Warning dialog appears
5. User clicks "Continue"
6. Library updated
7. 428 jobs queued for re-encoding
8. Toast: "Policy updated. 428 files queued for re-encoding"

### Error Scenarios
- **Node Offline:** Cannot create/edit library, show error
- **Path Not Found:** Show validation error on path field
- **Permission Denied:** Show error: "Cannot access path - check node permissions"
- **Duplicate Name:** Inline error: "Library name already exists"
- **No Policies Available:** Show error: "Create a policy first before adding libraries"

---

## 3. Encoding Policies

### Purpose
Define encoding rules, quality settings, and device compatibility profiles.

### Requirements

#### Policy List View
- Data table showing all policies
- Columns:
  - **Name** - Policy identifier
  - **Preset** - Encoding preset (QUALITY_HEVC, BALANCED_HEVC, SPEED_HEVC, QUALITY_H264, etc.)
  - **Target Codec** - Output codec (HEVC, H264, AV1)
  - **Quality (CRF)** - Constant Rate Factor value
  - **Hardware Acceleration** - Enabled/Disabled
  - **Libraries Using** - Count of libraries with this policy
  - **Active Jobs** - Current jobs using this policy
  - **Actions** - Edit, Delete, Duplicate
- Filter by codec or preset
- Sort by any column
- Default policy indicator (star icon)

#### Create Policy
**Form Fields:**

**Basic Settings:**
- **Name** (required, unique, max 100 chars)
  - Example: "4K HDR HEVC Quality"
- **Preset** (required, dropdown)
  - Options: QUALITY_HEVC, BALANCED_HEVC, SPEED_HEVC, QUALITY_H264, BALANCED_H264, SPEED_H264, AV1_QUALITY, AV1_BALANCED
  - Shows description for each preset
- **Target Codec** (required, dropdown)
  - Options: HEVC (H.265), H264 (H.264), AV1
  - Auto-selected based on preset
- **Target Quality (CRF)** (required, number, 0-51)
  - Lower = better quality, larger files
  - Default: 23 for HEVC, 21 for H264
  - Shows quality guide: 18-22 (high), 23-28 (medium), 29-35 (low)

**Advanced Settings (Expandable Section):**
- **Hardware Acceleration** (checkbox, default: true)
  - Uses VAAPI for faster encoding (if available on node)
  - Falls back to software encoding if unavailable
- **Audio Settings**
  - Copy audio streams (default) vs. Re-encode audio
  - Audio codec: AAC, AC3, DTS passthrough
  - Audio bitrate (if re-encoding): 128k, 192k, 256k, 320k
- **Subtitle Settings**
  - Copy all subtitle streams (default)
  - Burn-in subtitles (for specific tracks)
- **Video Filters**
  - Deinterlace (checkbox)
  - Denoise (checkbox)
  - Crop black bars (checkbox)

**Device Profiles (Optional):**
- **Enable Device Compatibility Mode** (checkbox)
- When enabled, shows profile options:
  - **4K HDR** - HDR10, Dolby Vision passthrough
  - **4K SDR** - Standard dynamic range 4K
  - **1080p** - Full HD, compatible with most devices
  - **720p** - HD, lower bandwidth
  - **Mobile** - Optimized for phones/tablets
- Each profile adjusts resolution, bitrate, codec settings

**Validation:**
- Name cannot be empty or duplicate
- CRF must be 0-51
- At least one audio/video stream must be selected

**Behavior:**
- Shows real-time preview of estimated bitrate and file size
- "Test Encode" button to test policy on sample file
- On save: Create policy, refresh list, show success toast

#### Edit Policy
- Same form as Create Policy
- Pre-populated with current values
- **Warning if policy has active jobs:** "This policy is used by X active encoding jobs. Changes will apply to new jobs only."
- **Warning if policy used by libraries:** "This policy is used by Y libraries. Editing may trigger re-encoding."

#### Delete Policy
- Confirmation dialog showing:
  - Policy name
  - Libraries using count
  - Active jobs count
  - Pending jobs count
  - Warning: "Cannot delete policy with active jobs or assigned libraries"
- Must unassign from libraries before deletion
- Alternative: "Archive" policy (hide from selection, keep for historical jobs)

#### Duplicate Policy
- Creates copy of policy with name: "Copy of [Original Name]"
- Opens edit form with copied values
- Allows quick creation of variant policies

#### Set Default Policy
- Mark policy as default for new libraries
- Shows "Default" badge on policy row
- Used when creating libraries without specifying policy

### API Endpoints
- `GET /api/policies` - List all policies
- `POST /api/policies` - Create policy
- `GET /api/policies/:id` - Get policy details
- `PATCH /api/policies/:id` - Update policy
- `DELETE /api/policies/:id` - Delete policy
- `POST /api/policies/:id/duplicate` - Duplicate policy
- `PATCH /api/policies/:id/set-default` - Set as default

### User Workflows

#### Workflow: Create HEVC Quality Policy
1. User navigates to Policies page
2. Clicks "Create Policy"
3. Enters name: "Movies 4K HEVC High Quality"
4. Selects preset: "QUALITY_HEVC"
5. Target codec auto-filled: "HEVC"
6. Sets CRF to 20 (high quality)
7. Expands Advanced Settings
8. Checks "Hardware Acceleration"
9. Sets Audio to "Copy streams"
10. Enables Device Profile: "4K HDR"
11. Clicks "Save"
12. Policy created, appears in list
13. Toast: "Policy created successfully"

#### Workflow: Edit Existing Policy
1. User finds policy "TV Shows HEVC" in list
2. Clicks "Edit" action
3. Changes CRF from 23 to 21 (better quality)
4. Warning shown: "Used by 3 libraries. Changes apply to new jobs only."
5. User clicks "Save"
6. Policy updated
7. Toast: "Policy updated. Active jobs unaffected."

### Error Scenarios
- **Cannot Delete Policy in Use:** Show error with library count
- **Invalid CRF Value:** Inline validation error
- **Hardware Acceleration Unavailable:** Warning: "Node does not support VAAPI. Will use software encoding."
- **Duplicate Name:** Inline error on name field

---

## 4. Compute Nodes

### Purpose
Manage distributed encoding workers (physical/virtual machines running encoding jobs).

### Requirements

#### Node List View
- Data table showing all nodes
- Columns:
  - **Name** - Node identifier (hostname)
  - **Status** - Online, Offline, Error, Unlicensed
  - **IP Address** - Node network address
  - **CPU Usage** - Current CPU utilization %
  - **Memory Usage** - RAM utilization %
  - **Disk Space** - Available storage
  - **Active Jobs** - Currently encoding files
  - **Total Jobs Completed** - Historical job count
  - **License Status** - Licensed, Trial, Expired
  - **Actions** - Edit, Test Connection, View Logs, Delete
- Real-time status updates (every 10s)
- Color-coded status indicators

#### Add Node
**Form Fields:**
- **Name** (required, unique)
  - Example: "pve-ai-encode-01"
  - Auto-generated from hostname option
- **IP Address** (required, validated)
  - IPv4 format validation
  - Example: "192.168.1.26"
- **SSH Port** (default: 22)
- **Connection Method** (dropdown)
  - SSH (default)
  - API endpoint (future)
- **License Key** (required)
  - Format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
  - Validates key before adding node
- **Hardware Acceleration** (auto-detected)
  - Shows detected capabilities: VAAPI, NVENC, QuickSync

**Validation:**
- Name cannot be empty or duplicate
- IP address must be valid IPv4
- Port must be 1-65535
- License key must be valid format
- Test connection before allowing save

**Behavior:**
- "Test Connection" button validates SSH access
- On success: Add node, activate license, show toast
- On error: Show connection error details

#### Edit Node
- Same form as Add Node
- Cannot edit IP address (must delete and re-add)
- Can update name, port, license key
- Shows current license status and expiration

#### Node Details View
- Modal or dedicated page showing:
  - **System Info** - OS, kernel version, CPU model, RAM
  - **Encoding Capabilities** - Supported codecs, hardware acceleration
  - **Storage Volumes** - All mounted filesystems with usage
  - **Active Jobs** - Currently encoding files
  - **Job History** - Recent completed/failed jobs
  - **Performance Graph** - CPU/Memory over time (24h)
  - **Error Log** - Recent errors and warnings

#### Test Connection
- Validates SSH connectivity
- Checks FFmpeg installation
- Detects hardware acceleration support
- Verifies write access to temp directory
- Shows detailed results in modal
- Pass/Fail for each check with recommendations

#### Delete Node
- Confirmation dialog showing:
  - Node name and IP
  - Active jobs count (must be 0 to delete)
  - Libraries using this node
  - Warning: "Cannot delete node with active jobs"
- Must reassign libraries to different node before deletion
- Deactivates license on successful deletion

### API Endpoints
- `GET /api/nodes` - List all nodes
- `POST /api/nodes` - Add node
- `GET /api/nodes/:id` - Get node details
- `PATCH /api/nodes/:id` - Update node
- `DELETE /api/nodes/:id` - Delete node
- `POST /api/nodes/:id/test` - Test connection
- `GET /api/nodes/:id/stats` - Get real-time stats

### User Workflows

#### Workflow: Add New Encode Node
1. User navigates to Nodes page
2. Clicks "Add Node"
3. Enters name: "pve-labg5-encoder"
4. Enters IP: "192.168.1.30"
5. Keeps port: 22
6. Enters license key: "XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
7. Clicks "Test Connection"
8. Test succeeds, shows: "✓ SSH connected, ✓ FFmpeg found, ✓ VAAPI supported"
9. Clicks "Add Node"
10. Node added, license activated
11. Toast: "Node added successfully. Ready for encoding."

#### Workflow: Troubleshoot Offline Node
1. User sees node "pve-ai" showing "Offline" status
2. Clicks node row to open details
3. Reviews error log: "SSH connection timeout"
4. Clicks "Test Connection"
5. Test fails: "Cannot reach host"
6. User checks network connectivity
7. After fixing network issue, clicks "Test Connection" again
8. Test succeeds
9. Node status changes to "Online"

### Error Scenarios
- **Invalid License Key:** Show error: "License key is invalid or already in use"
- **SSH Connection Failed:** Show detailed error with troubleshooting steps
- **Cannot Delete Node in Use:** Show error listing dependent libraries
- **Node Unreachable:** Show "Offline" status, disable job assignment

---

## 5. Jobs & Queue Management

### Purpose
Monitor encoding job progress, view logs, and manage the job queue.

### Requirements

#### Job List View
- Data table showing all jobs (active, pending, completed, failed)
- Columns:
  - **File Name** - Video file being encoded
  - **Library** - Source library
  - **Policy** - Encoding policy used
  - **Node** - Node processing the job
  - **Status** - Pending, Active, Completed, Failed, Cancelled
  - **Progress** - 0-100% with progress bar
  - **Speed** - Encoding fps
  - **ETA** - Estimated time remaining
  - **Started At** - Job start timestamp
  - **Duration** - Total encoding time
  - **Size Before** - Original file size
  - **Size After** - Encoded file size
  - **Savings** - Percentage reduction
  - **Actions** - Cancel, Retry, View Logs, Delete
- Filter by status, library, policy, node, date range
- Sort by any column
- Pagination with 50/100/200 per page
- Real-time updates for active jobs (every 5s)

#### Active Jobs (Real-time Dashboard)
- Separate tab showing only actively encoding jobs
- Live progress bars with smooth animations
- Shows:
  - Current encoding frame
  - Total frames
  - Encoding speed (fps)
  - ETA countdown
  - Current pass (1-pass or 2-pass encoding)
- Grouped by node
- "Cancel All" button (with confirmation)

#### Pending Jobs Queue
- Shows jobs waiting to start
- Displays queue position (#1, #2, #3...)
- Priority indicator (High, Normal, Low)
- Estimated start time based on active job ETAs
- Drag-and-drop to reorder queue
- "Clear Queue" button (with confirmation)
- Filter by library or policy

#### Failed Jobs
- Dedicated view for failed jobs
- Shows error message and FFmpeg log excerpt
- Quick actions:
  - Retry (re-queue with same settings)
  - Retry with Different Policy
  - Skip (mark as ignored)
  - Delete
- Bulk retry option for multiple failures

#### Job Details Modal
- Opens when clicking job row
- Tabs:
  - **Overview** - Summary stats, file info, encoding settings
  - **Progress** - Real-time encoding progress (if active)
  - **Logs** - Full FFmpeg output log
  - **File Info** - MediaInfo details (before/after)
  - **Performance** - Encoding speed graph over time
- Actions: Cancel, Retry, Download Logs, Compare Files

#### Job Actions
- **Cancel Job** - Stop active encoding, mark as cancelled
- **Retry Job** - Re-queue failed job with same settings
- **Change Priority** - Move job up/down in queue
- **Delete Job Record** - Remove from history (doesn't delete files)
- **Skip File** - Mark file as "do not encode" (add to ignore list)

#### Bulk Actions
- Select multiple jobs with checkboxes
- Actions:
  - Cancel Selected
  - Retry Selected
  - Delete Selected
  - Change Priority
  - Export Job Details (CSV)

### API Endpoints
- `GET /api/jobs` - List jobs with filters
- `GET /api/jobs/:id` - Get job details
- `POST /api/jobs/:id/cancel` - Cancel active job
- `POST /api/jobs/:id/retry` - Retry failed job
- `PATCH /api/jobs/:id/priority` - Change priority
- `DELETE /api/jobs/:id` - Delete job record
- `GET /api/jobs/:id/logs` - Get full logs
- `POST /api/jobs/bulk-cancel` - Cancel multiple jobs

### User Workflows

#### Workflow: Monitor Active Encoding
1. User navigates to Jobs page
2. Selects "Active" tab
3. Sees 3 jobs currently encoding
4. Watches progress bar for "movie.mkv" increase from 45% to 50%
5. ETA updates from 12 minutes to 10 minutes
6. Encoding speed: 85 fps
7. User clicks job row to view details
8. Logs tab shows live FFmpeg output scrolling
9. User sees encoding is progressing normally

#### Workflow: Retry Failed Job
1. User navigates to "Failed" tab
2. Sees 5 failed jobs from last night
3. Clicks first failed job
4. Error message: "Unsupported codec: VC-1"
5. User clicks "Retry with Different Policy"
6. Selects policy: "Universal H264 Compatible"
7. Clicks "Retry"
8. Job re-queued with new policy
9. Toast: "Job re-queued successfully"

#### Workflow: Clear Pending Queue
1. User sees 150 pending jobs in queue
2. Realizes wrong policy was assigned
3. Clicks "Clear Queue" button
4. Confirmation: "Cancel 150 pending jobs?"
5. User confirms
6. All pending jobs cancelled
7. Toast: "150 jobs cancelled"

### Error Scenarios
- **Cannot Cancel Completed Job:** Show error: "Job already completed"
- **Node Went Offline During Encoding:** Job marked as failed, error: "Node connection lost"
- **Disk Full:** Job fails with error: "No space left on device"
- **FFmpeg Crash:** Job fails with error: "Encoder process terminated unexpectedly"

---

## 6. Statistics & Reporting

### Purpose
Provide insights into encoding efficiency, storage savings, and system performance.

### Requirements

#### Statistics Dashboard
**Summary Cards:**
- **Total Jobs Processed** - All-time count
- **Success Rate** - Percentage of successful encodings
- **Total Storage Saved** - Cumulative space savings
- **Average Savings Per File** - Mean percentage reduction
- **Total Encoding Time** - Cumulative hours spent encoding
- **Average Encoding Speed** - Mean fps across all jobs

**Charts:**
- **Jobs Over Time** - Line graph (daily, weekly, monthly)
  - Completed jobs per time period
  - Failed jobs per time period
  - Success rate trend
- **Storage Savings Trend** - Area chart showing cumulative savings
- **Encoding by Library** - Pie chart showing job distribution
- **Encoding by Policy** - Bar chart showing most-used policies
- **Node Performance** - Stacked bar chart showing jobs per node
- **Average File Size Reduction** - Histogram showing distribution

**Time Range Selector:**
- Last 24 Hours
- Last 7 Days
- Last 30 Days
- Last 90 Days
- All Time
- Custom Date Range

**Filters:**
- By Library
- By Policy
- By Node
- By Codec (HEVC, H264, AV1)
- By Status (Success, Failed)

#### Library Statistics
- Per-library breakdown:
  - Total files in library
  - Files encoded
  - Files pending
  - Files failed
  - Storage before encoding
  - Storage after encoding
  - Total savings for library
  - Average savings percentage
  - Most common video codec detected
  - Most common resolution

#### Policy Statistics
- Per-policy breakdown:
  - Jobs using this policy
  - Success rate
  - Average encoding time
  - Average file size reduction
  - Most common source codec
  - Most common source resolution

#### Node Performance Report
- Per-node breakdown:
  - Total jobs processed
  - Success rate
  - Average encoding speed (fps)
  - Total encoding time
  - Uptime percentage
  - Hardware acceleration usage
  - Peak CPU/Memory during encoding

#### Export Reports
- Generate CSV/PDF reports
- Include:
  - Job details (all fields)
  - Aggregate statistics
  - Charts/graphs (PDF only)
  - Custom date range
- Email report option (future)

### API Endpoints
- `GET /api/statistics/overview` - Dashboard summary
- `GET /api/statistics/jobs?timeRange=7d` - Job statistics
- `GET /api/statistics/libraries` - Per-library stats
- `GET /api/statistics/policies` - Per-policy stats
- `GET /api/statistics/nodes` - Per-node stats
- `GET /api/statistics/export?format=csv` - Export report

### User Workflows

#### Workflow: Review Monthly Performance
1. User navigates to Statistics page
2. Selects "Last 30 Days" time range
3. Dashboard loads showing:
   - 1,247 jobs completed
   - 94% success rate
   - 2.3 TB storage saved
   - Average 42% file size reduction
4. User reviews "Jobs Over Time" chart
5. Sees encoding spike on weekends (when new content added)
6. User reviews "Node Performance" chart
7. Sees "pve-ai" processed most jobs (65%)
8. User exports report as PDF for records

### Error Scenarios
- **No Data Available:** Show empty state: "No jobs found in selected time range"
- **Chart Load Error:** Show error: "Unable to load chart. Please refresh."

---

## 7. Settings & Configuration

### Purpose
Configure application-wide settings, license management, and user preferences.

### Requirements

#### General Settings
- **Application Name** - Customizable branding
- **Default Policy** - Policy used for new libraries
- **Default Node** - Preferred node for new libraries
- **Auto-Scan Interval** - How often to rescan libraries (hourly, daily, never)
- **Job Retention** - How long to keep completed job records (30d, 90d, 1yr, forever)
- **Failed Job Retention** - How long to keep failed job records
- **Log Level** - Debug, Info, Warning, Error
- **API Base URL** - Backend endpoint (for multi-instance setups)

#### License Management
- **License Type** - Community (free), Professional, Enterprise
- **Node Licenses** - List of activated nodes with keys
- **License Expiration** - Days until renewal required
- **Add License Key** - Form to activate new node
- **Deactivate License** - Remove license from node
- **Transfer License** - Move license to different node

#### User Preferences
- **Theme** - Light, Dark, Auto (system)
- **Language** - English (future: multi-language support)
- **Timezone** - For timestamp display
- **Date Format** - MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD
- **Time Format** - 12-hour, 24-hour
- **Notifications** - Enable/disable browser notifications
- **Auto-Refresh Intervals** - How often to update live data

#### FFmpeg Settings
- **FFmpeg Path** - Custom path to FFmpeg binary (per node)
- **FFprobe Path** - Custom path to FFprobe binary
- **Temp Directory** - Where to store intermediate files
- **Concurrent Jobs Per Node** - Max simultaneous encodings (1-10)
- **2-Pass Encoding** - Enable for better quality (slower)
- **Overwrite Original** - Replace source file vs. create new file
- **File Naming** - Output filename pattern

#### Advanced Settings
- **Database Backup** - Schedule automated backups
- **API Rate Limiting** - Requests per minute threshold
- **CORS Settings** - Allowed origins for API access
- **Webhook URL** - Notify external services on events
- **Debug Mode** - Enable verbose logging

#### Danger Zone
- **Reset Statistics** - Clear all job history and stats
- **Clear Job Queue** - Cancel all pending jobs
- **Factory Reset** - Delete all configuration (confirm with password)

### API Endpoints
- `GET /api/settings` - Get all settings
- `PATCH /api/settings` - Update settings
- `GET /api/license` - Get license info
- `POST /api/license/activate` - Activate license key
- `DELETE /api/license/:nodeId` - Deactivate license

### User Workflows

#### Workflow: Configure Auto-Scan
1. User navigates to Settings page
2. Scrolls to "General Settings"
3. Changes "Auto-Scan Interval" from "Never" to "Daily at 2:00 AM"
4. Clicks "Save"
5. Toast: "Settings updated. Auto-scan scheduled."

#### Workflow: Activate Node License
1. User navigates to Settings > License Management
2. Clicks "Add License Key"
3. Selects node: "pve-labg5"
4. Enters license key: "XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
5. Clicks "Activate"
6. License validated and activated
7. Node now available for job assignment
8. Toast: "License activated successfully"

### Error Scenarios
- **Invalid License Key:** Show error: "License key is invalid or expired"
- **License Already in Use:** Show error: "This license is already activated on another node"
- **Settings Save Failed:** Show error with retry option

---

## 8. Authentication & Authorization (Future)

### Purpose
Secure the application and control access levels.

### Requirements (Planned)

#### User Management
- Admin, Operator, Viewer roles
- Username/password authentication
- Session management
- Password reset via email

#### Permissions
- **Admin** - Full access to all features
- **Operator** - Can manage libraries, policies, jobs (cannot edit settings/licenses)
- **Viewer** - Read-only access to dashboard and statistics

#### API Security
- JWT token-based authentication
- API key support for external integrations
- Rate limiting per user/API key

---

## Non-Functional Requirements

### Performance
- Dashboard must load in < 2 seconds
- Job list must support 10,000+ records without pagination lag
- Real-time updates must not cause UI jank
- Chart rendering < 1 second for 90 days of data
- API endpoints must respond in < 500ms (p95)
- Support 100+ concurrent encoding jobs across nodes

### Scalability
- Support 50+ compute nodes
- Support 1,000+ libraries
- Support 100,000+ files tracked
- Support 500,000+ job records

### Reliability
- 99.9% uptime for API service
- Automatic reconnection to nodes after network interruption
- Job recovery after application restart
- No data loss during crashes
- Graceful degradation if nodes go offline

### Security
- All API endpoints require authentication (future)
- SQL injection prevention via Prisma ORM
- XSS protection in Angular templates
- CSRF token validation
- Secrets encrypted at rest
- SSH keys stored securely

### Accessibility (WCAG 2.1 Level AA)
- All interactive elements keyboard accessible
- Screen reader support for all content
- Proper ARIA labels and roles
- Color contrast ratios meet standards
- Focus indicators visible
- Forms have clear labels and error messages
- Tables have proper headers and associations
- Modals trap focus and return focus on close

### Browser Support
- Chrome/Edge 100+ (primary)
- Firefox 100+ (secondary)
- Safari 15+ (secondary)
- Mobile browsers (responsive design)

### Localization (Future)
- English (primary)
- Support for additional languages via i18n
- Date/time formatting per locale
- Number formatting per locale

---

## Data Models

### Library
- `id` - UUID
- `name` - String (unique)
- `path` - String (absolute path)
- `nodeId` - UUID (foreign key)
- `policyId` - UUID (foreign key)
- `status` - Enum (ACTIVE, PAUSED, SCANNING, ERROR)
- `fileCount` - Integer
- `totalSize` - BigInt (bytes)
- `lastScanAt` - DateTime
- `createdAt` - DateTime
- `updatedAt` - DateTime

### Policy
- `id` - UUID
- `name` - String (unique)
- `preset` - Enum (QUALITY_HEVC, BALANCED_HEVC, etc.)
- `targetCodec` - Enum (HEVC, H264, AV1)
- `targetQuality` - Integer (CRF 0-51)
- `hardwareAcceleration` - Boolean
- `deviceProfiles` - JSON (optional settings)
- `isDefault` - Boolean
- `createdAt` - DateTime
- `updatedAt` - DateTime

### Node
- `id` - UUID
- `name` - String (unique)
- `ipAddress` - String
- `port` - Integer
- `status` - Enum (ONLINE, OFFLINE, ERROR, UNLICENSED)
- `licenseKey` - String (encrypted)
- `licenseStatus` - Enum (ACTIVE, EXPIRED, TRIAL)
- `capabilities` - JSON (hardware acceleration, codecs)
- `createdAt` - DateTime
- `updatedAt` - DateTime

### Job
- `id` - UUID
- `libraryId` - UUID (foreign key)
- `policyId` - UUID (foreign key)
- `nodeId` - UUID (foreign key)
- `filePath` - String
- `fileName` - String
- `status` - Enum (PENDING, ACTIVE, COMPLETED, FAILED, CANCELLED)
- `progress` - Float (0-100)
- `encodingSpeed` - Float (fps)
- `sizeBeforeBytes` - BigInt
- `sizeAfterBytes` - BigInt
- `savedBytes` - BigInt
- `savedPercent` - Float
- `errorMessage` - String (nullable)
- `startedAt` - DateTime (nullable)
- `completedAt` - DateTime (nullable)
- `createdAt` - DateTime

### License
- `id` - UUID
- `nodeId` - UUID (foreign key)
- `licenseKey` - String (unique, encrypted)
- `type` - Enum (COMMUNITY, PROFESSIONAL, ENTERPRISE)
- `expiresAt` - DateTime (nullable)
- `activatedAt` - DateTime
- `deactivatedAt` - DateTime (nullable)

---

## Success Metrics

### Product Success
- **User Adoption** - 100+ active installations within 6 months
- **Storage Savings** - Average 40%+ file size reduction
- **Encoding Success Rate** - 95%+ jobs complete without errors
- **User Satisfaction** - 4.5+ star rating (feedback surveys)

### Performance Metrics
- **Dashboard Load Time** - < 2 seconds (p95)
- **API Response Time** - < 500ms (p95)
- **Job Processing Throughput** - 10+ files per hour per node
- **System Uptime** - 99.9%+

### Engagement Metrics
- **Daily Active Users** - 80% of installations
- **Libraries Per User** - Average 5+ libraries configured
- **Jobs Per Day** - 50+ encoding jobs per installation
- **Feature Adoption** - 70%+ users configure custom policies

---

## Release Roadmap

### v1.0 - Core Features (Current)
- ✅ Dashboard / Overview
- ✅ Libraries Management
- ✅ Encoding Policies
- ✅ Compute Nodes
- ✅ Jobs & Queue Management
- ✅ Basic Statistics

### v1.1 - Enhanced Monitoring
- Advanced statistics and reporting
- Performance graphs and trends
- Export reports (CSV/PDF)
- Email notifications for job failures

### v1.2 - User Management
- Authentication system (username/password)
- Role-based access control (Admin, Operator, Viewer)
- User activity logging
- API key management

### v1.3 - Advanced Features
- Scheduled library scans
- Custom file filters (regex patterns)
- Library groups/tags
- Bulk operations (multi-library actions)
- Dark mode theme

### v2.0 - Enterprise Features
- Multi-tenant support
- LDAP/SSO integration
- Advanced licensing tiers
- Webhook integrations
- REST API documentation (OpenAPI)
- Mobile app (iOS/Android)

---

## Appendix

### Encoding Presets Explained

| Preset | Codec | CRF | Speed | Quality | Use Case |
|--------|-------|-----|-------|---------|----------|
| QUALITY_HEVC | HEVC | 20 | Slow | Excellent | Archival, 4K content |
| BALANCED_HEVC | HEVC | 23 | Medium | Good | General purpose |
| SPEED_HEVC | HEVC | 26 | Fast | Fair | Quick encodes, TV shows |
| QUALITY_H264 | H264 | 18 | Slow | Excellent | Max compatibility |
| BALANCED_H264 | H264 | 21 | Medium | Good | Streaming devices |
| SPEED_H264 | H264 | 24 | Fast | Fair | Older hardware |
| AV1_QUALITY | AV1 | 25 | Very Slow | Excellent | Future-proof, max savings |
| AV1_BALANCED | AV1 | 30 | Slow | Good | Efficient streaming |

### FFmpeg Hardware Acceleration Support

| Technology | Codec Support | Requirements |
|------------|--------------|--------------|
| VAAPI | HEVC, H264, VP9 | Intel/AMD GPUs with Linux drivers |
| NVENC | HEVC, H264, AV1 | NVIDIA GPUs (GTX 10-series+) |
| QuickSync | HEVC, H264 | Intel CPUs (6th gen+) |
| VideoToolbox | HEVC, H264 | macOS systems |

### Common Error Messages

| Error | Cause | Resolution |
|-------|-------|------------|
| "Node connection timeout" | Node unreachable | Check network, SSH service |
| "Codec not supported" | Source codec incompatible | Use different policy/preset |
| "No space left on device" | Disk full on node | Free up space, add storage |
| "License expired" | Node license invalid | Renew or activate license |
| "Path not found" | Library path deleted/moved | Update library path or delete library |
| "FFmpeg process crashed" | Corrupted source file | Skip file or re-download source |

### Glossary

- **CRF (Constant Rate Factor)** - Quality setting for video encoding (lower = better quality)
- **HEVC (H.265)** - Modern video codec with better compression than H.264
- **Hardware Acceleration** - Using GPU instead of CPU for faster encoding
- **VAAPI** - Video Acceleration API (Linux hardware encoding)
- **Node** - Compute server running encoding jobs
- **Policy** - Set of encoding rules and quality settings
- **Library** - Directory of video files to be monitored and encoded
- **Job** - Single file encoding task
- **Queue** - List of pending encoding jobs
- **Preset** - Predefined encoding configuration template
