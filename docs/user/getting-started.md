# Getting Started with BitBonsai

> **Quick start guide to transform your media library in minutes**

This guide will walk you through your first BitBonsai setup, from installation to encoding your first video.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Adding Your First Library](#adding-your-first-library)
- [Creating Your First Policy](#creating-your-first-policy)
- [Starting Your First Job](#starting-your-first-job)
- [Queue Management](#queue-management)
- [Adding Child Nodes](#adding-child-nodes)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, ensure you have:

- **BitBonsai installed** - See [Installation Guide](./installation.md)
- **Media files** - Movies, TV shows, or videos to encode
- **Storage space** - At least 20% free space for encoding temp files
- **Optional**: GPU for hardware acceleration (NVIDIA, Intel, AMD)

**Recommended for Unraid Users:**
- SSD cache pool for `/cache` volume (10-100x faster encoding)
- See [Unraid Release Guide](../releases/unraid.md#cache-pool-configuration)

---

## Initial Setup

### 1. Access BitBonsai

After installation, navigate to:

- **Docker**: `http://localhost:4210`
- **Unraid**: `http://YOUR_SERVER_IP:4210`
- **LXC/Proxmox**: `http://YOUR_LXC_IP:4210`

### 2. First Login

Default credentials (change immediately):
- **Username**: admin
- **Password**: See your installation method

**IMPORTANT**: Change your password on first login:
1. Click profile icon (top right)
2. Select "Change Password"
3. Enter a strong password

### 3. Check System Status

Verify your installation:

1. **Dashboard** - Should show "1 Active Node" (your main node)
2. **Hardware Info** - Check detected GPU acceleration
3. **Storage** - Verify media paths are accessible

**GPU Acceleration Status:**
- ✅ NVIDIA NVENC detected
- ✅ Intel QuickSync (QSV) detected
- ✅ AMD AMF detected
- ℹ️ CPU-only (no GPU found)

---

## Adding Your First Library

Libraries tell BitBonsai where your media files are located.

### 1. Create a Library

1. Navigate to **Libraries** page
2. Click **+ Add Library** button
3. Fill in details:
   - **Name**: "Movies" (or your preference)
   - **Path**: `/media/Movies` (adjust to your path)
   - **Type**: Movies, TV Shows, Anime, or General
   - **Scan on startup**: Enable for automatic updates
4. Click **Save**

### 2. Scan Your Library

BitBonsai will automatically:
- Scan all video files in the directory
- Detect codecs (H.264, HEVC, AV1, etc.)
- Calculate total size and potential savings
- Show codec distribution chart

**Scanning Progress:**
- Watch the progress bar in the notification
- Large libraries (1000+ files) may take 5-10 minutes
- You can continue setup while scanning

### 3. Review Scan Results

After scanning, you'll see:
- **Total files**: Number of videos found
- **Codec breakdown**: H.264, HEVC, AV1, VP9, etc.
- **Storage used**: Current library size
- **Potential savings**: Estimated space reduction

Example:
```
Total Files: 847
H.264: 623 (73.5%)
HEVC: 201 (23.7%)
AV1: 23 (2.7%)

Current Size: 1.2 TB
Potential Savings: 480 GB (40%)
```

---

## Creating Your First Policy

Policies define how BitBonsai encodes your files.

### 1. Navigate to Policies

1. Click **Policies** in sidebar
2. Click **+ Create Policy**

### 2. Configure Policy Settings

**Basic Settings:**
- **Name**: "H.264 to HEVC" (descriptive name)
- **Description**: "Convert all H.264 movies to HEVC for space savings"

**Source Filters:**
- **Libraries**: Select "Movies" (or your library)
- **Source Codec**: H.264 (only encode H.264 files)
- **Min File Size**: 100 MB (skip small files)
- **Max File Size**: None (no upper limit)

**Target Encoding:**
- **Target Codec**: HEVC (H.265)
- **Quality (CRF)**: 23 (balanced quality/size)
  - Lower = better quality, larger files (18-22)
  - Higher = smaller files, lower quality (24-28)
- **Preset**: Medium (balanced speed/compression)
  - Slow/Slower = better compression
  - Fast/Faster = quicker encoding

**Hardware Acceleration:**
- **Use GPU**: Enable if detected
- **Encoder**: Auto (NVENC, QSV, or AMF)

**Audio & Subtitles:**
- **Audio**: Copy all tracks (no re-encoding)
- **Subtitles**: Copy all tracks

**Advanced Options:**
- **Keep original**: No (replace after verification)
- **Backup before encoding**: Optional (safety net)
- **Enable auto-heal**: Yes (resume after crashes)

### 3. Save Policy

Click **Create Policy** - Your policy is now active!

---

## Starting Your First Job

### 1. Queue Files

After creating a policy, BitBonsai automatically:
- Scans libraries for matching files
- Queues them for encoding
- Prioritizes by file size (largest first)

**Manual Queue:**
1. Navigate to **Queue** page
2. Click **Scan Libraries**
3. Select policy to apply
4. Click **Queue Matching Files**

### 2. Monitor Progress

The **Queue** page shows:

**Active Jobs:**
- File name and path
- Current progress (%)
- Encoding speed (FPS)
- Estimated time remaining (ETA)
- Current stage (Analyzing, Encoding, Verifying)

**Pending Jobs:**
- Files waiting to be encoded
- Total pending count
- Library filter (show specific library)

**Completed Jobs:**
- Successfully encoded files
- Space saved per file
- Encoding duration

### 3. Watch Live Updates

Real-time updates via WebSocket:
- Progress bar updates every second
- FPS (frames per second) shows encoding speed
- ETA recalculates based on current speed

**Performance Indicators:**
- **40+ FPS**: Excellent (GPU encoding)
- **20-40 FPS**: Good (CPU encoding, modern hardware)
- **10-20 FPS**: Normal (CPU encoding, older hardware)
- **<10 FPS**: Slow (consider GPU upgrade)

### 4. Verify Results

After encoding completes:

1. **Verification Stage** (automatic)
   - Checks encoded file integrity
   - Compares duration and quality
   - Ensures no corruption

2. **File Replacement**
   - Original moved to backup (if enabled)
   - Encoded file replaces original
   - Permissions and metadata preserved

3. **Statistics Updated**
   - Space saved calculated
   - Total encoding time logged
   - Success/failure tracked

---

## Queue Management

### Priority Queue

Pin urgent jobs to the top:

1. Find job in **Pending** section
2. Click **Pin** icon
3. Job moves to top of queue
4. Encodes next (after active jobs complete)

**Use cases:**
- Newly added content you want to watch soon
- Fixing failed encodes that need immediate retry
- Testing new policy settings

### Library Filtering

For multi-library setups:

1. Click **Filter by Library** dropdown
2. Select specific library (e.g., "TV Shows")
3. View only jobs from that library

**Benefits:**
- Focus on specific content
- Monitor library-specific progress
- Identify bottlenecks

### Bulk Operations

Coming in v0.2:
- Retry all failed jobs
- Clear completed jobs
- Export queue data (CSV, JSON)

---

## Adding Child Nodes

**Commercial tier only** - Scale your encoding capacity with distributed nodes.

### Auto-Discovery Setup

The easiest method for home networks:

**Main Node Requirements:**
- Docker host networking (`--network=host`)
- Firewall allows mDNS (port 5353/UDP)
- All nodes on same subnet/VLAN

**Steps:**

1. **Prepare Child Node**
   - Install BitBonsai on second machine
   - Ensure same media paths (NFS/SMB mount)
   - Connect to same network as main node

2. **Launch Node Setup Wizard**
   - Navigate to `/node-setup` on child node
   - Click "Scan for Nodes"

3. **Select Main Node**
   - BitBonsai discovers main nodes automatically
   - Select your main node from list
   - Enter child node name (e.g., "Office PC")

4. **Enter Pairing Code**
   - 6-digit code displayed on child node
   - Approve pairing on main node dashboard
   - Connection established automatically

5. **Verify Connection**
   - Dashboard shows "2 Active Nodes"
   - Check hardware detection summary
   - Jobs now distributed across both nodes

### Manual Pairing

For complex networks (VLANs, VPNs, remote nodes):

**Steps:**

1. **Get Main Node URL**
   - Note your main node IP: `192.168.1.100`
   - Note port (default: 4210)
   - Full URL: `http://192.168.1.100:4210`

2. **Launch Manual Pairing**
   - Navigate to `/node-setup` on child node
   - Click "Manual Pairing"
   - Enter main node URL

3. **Request Pairing**
   - Child node requests pairing token
   - 6-digit code displayed

4. **Approve on Main Node**
   - Navigate to main node dashboard
   - Click "Pending Requests" bell icon
   - Review request details
   - Click "Approve"

5. **Connection Established**
   - Child node receives connection token
   - Automatic registration with main node
   - Begin receiving encoding jobs

### Node Performance Monitoring

Track each node's contribution:

**Per-Node Statistics:**
- Jobs completed
- Total encoding time
- Average FPS
- Storage saved
- Active/idle status

**Dashboard Overview:**
- Node tile grid (compact view)
- CPU/GPU indicators
- Memory and disk usage
- Connection status

---

## Troubleshooting

### No Files Queued After Creating Policy

**Possible causes:**
1. Library not scanned yet
2. No files match policy filters
3. All matching files already encoded

**Solution:**
1. Check library scan status
2. Review policy filters (too restrictive?)
3. Click "Scan Libraries" to refresh
4. Check completed jobs for already-processed files

### Encoding Stuck at 0%

**Possible causes:**
1. FFmpeg not detecting input file
2. Codec not supported
3. File permissions issue

**Solution:**
1. Check job details for error message
2. Verify file exists at path
3. Check Docker volume mounts
4. Review FFmpeg logs (click "View Logs")

### Slow Encoding Speed (<5 FPS)

**Possible causes:**
1. CPU-only encoding (no GPU)
2. Wrong encoder selected
3. Disk I/O bottleneck
4. Insufficient resources

**Solution:**
1. Enable GPU acceleration if available
2. Check hardware detection in dashboard
3. Use SSD cache pool (Unraid users)
4. Reduce concurrent jobs
5. Lower preset (use "faster" instead of "slow")

### Troubleshooting Node Discovery

**Auto-discovery not working:**

1. **Verify Host Networking**
   ```bash
   docker inspect bitbonsai | grep NetworkMode
   # Should show: "NetworkMode": "host"
   ```

2. **Check mDNS Port**
   ```bash
   # On main node
   netstat -an | grep 5353
   # Should show UDP port 5353 listening
   ```

3. **Test Network Connectivity**
   ```bash
   # From child node
   ping <main-node-ip>
   curl http://<main-node-ip>:4210/api/health
   ```

4. **Firewall Rules**
   - Allow UDP port 5353 (mDNS)
   - Allow TCP port 4210 (BitBonsai frontend)
   - Allow TCP port 3100 (BitBonsai API)

**Solution:** If auto-discovery fails, use [Manual Pairing](#manual-pairing) instead.

### TRUE RESUME Not Working

**Symptoms:**
- Jobs restart from 0% after crash
- Temp files missing

**Possible causes:**
1. Auto-heal disabled
2. Temp files deleted
3. Cache pool not configured (Unraid)

**Solution:**
1. Check auto-heal status in logs:
   ```
   ⚡ Cache pool ENABLED: Using /cache for temp files
   🔍 Scanning for orphaned jobs...
   ✅ TRUE RESUME: Will resume from 00:01:19
   ```

2. Verify temp file location:
   - Docker: `/tmp` inside container
   - Unraid: `/mnt/cache/bitbonsai-temp`

3. Check policy settings:
   - "Enable auto-heal" must be checked

### High Memory Usage

**Normal behavior:**
- Active encoding jobs use 500MB-2GB per job
- FFmpeg loads video into memory for processing

**Excessive usage (>4GB):**
1. Reduce concurrent jobs
2. Check for memory leaks (restart container)
3. Review Docker resource limits

---

## Next Steps

Now that you're up and running:

1. **[Explore Encoding Policies](./encoding-policies.md)** - Advanced policy configuration
2. **[Docker Setup Guide](./docker-setup.md)** - Optimize your deployment
3. **[Architecture Overview](../development/architecture.md)** - Understand how it works
4. **[Unraid Optimization](../releases/unraid.md)** - Cache pool performance tips

---

## Support

Need help?

- **Documentation**: Check other guides in `/docs`
- **GitHub Issues**: [Report bugs or request features](https://github.com/lucidfabrics/bitbonsai/issues)
- **Discord**: [Join the community](https://discord.gg/lucidfabrics)
- **Commercial Support**: [support@lucidfabrics.com](mailto:support@lucidfabrics.com)

---

<div align="center">

**Happy encoding! 🎬**

[Back to Docs Home](../README.md) • [Installation Guide](./installation.md) • [Encoding Policies](./encoding-policies.md)

</div>
