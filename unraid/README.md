# 🌳 BitBonsai - Unraid Community Apps Template

## Installation on Unraid

### Method 1: Community Applications (Recommended - Coming Soon)
1. Open Unraid WebUI
2. Navigate to **Apps** tab
3. Search for **"BitBonsai"**
4. Click **Install**
5. Configure paths and ports
6. Click **Apply**

### Method 2: Manual Template Installation
1. Navigate to **Docker** tab in Unraid
2. Click **Add Container** at the bottom
3. Click **Template repositories**
4. Add this URL: `https://github.com/wassimmehanna/bitbonsai`
5. Select **BitBonsai** template
6. Configure and apply

### Method 3: Direct Docker Command
```bash
docker run -d \
  --name=bitbonsai \
  --restart=unless-stopped \
  -p 3000:3000 \
  -e TZ=America/New_York \
  -e NODE_ENV=production \
  -e API_PREFIX=api/v1 \
  -v /mnt/user/media:/media:ro \
  -v /mnt/user/Downloads:/downloads:ro \
  -v /mnt/user/appdata/bitbonsai:/app/data \
  lucidfabrics/bitbonsai:latest
```

## Configuration

### Required Settings
- **API Port**: `3000` - Port for Web UI and API access
- **Media Path**: `/mnt/user/media` - Your media library location (read-only recommended)

### Optional Settings
- **Downloads Path**: `/mnt/user/Downloads` - Your downloads folder (read-only)
- **App Data**: `/mnt/user/appdata/bitbonsai` - Scan results and config storage
- **Timezone**: `America/New_York` - Your timezone for scheduled scans
- **Node Environment**: `production` - Leave as default
- **API Prefix**: `api/v1` - Leave as default

## Accessing BitBonsai

After installation, access the web interface at:
```
http://[UNRAID-IP]:3000
```

Example: `http://192.168.1.100:3000`

## Recommended Unraid Setup

### Folder Structure
```
/mnt/user/
├── media/              # Your media library (mounted read-only)
│   ├── Movies/
│   ├── TV/
│   ├── Anime/
│   └── Anime Movies/
├── Downloads/          # Downloads folder (optional)
└── appdata/
    └── bitbonsai/  # App configuration and scan results
```

### Integration with Media Servers
BitBonsai works great alongside:
- **Plex** - Analyze your Plex library structure
- **Jellyfin** - Understand codec distribution
- **Emby** - Track storage usage
- **Sonarr/Radarr** - Verify media organization

### Performance Tips
1. **Read-Only Mounts**: Mount media folders as read-only (`:ro`) for safety
2. **Initial Scan**: First scan may take time depending on library size
3. **Scheduled Scans**: Configure auto-refresh interval in settings
4. **Resource Usage**: Minimal CPU/RAM usage during scans

## Updating BitBonsai

### Via Unraid Docker Manager
1. Navigate to **Docker** tab
2. Click **Check for Updates**
3. If update available, click **Update**
4. Container will restart automatically

### Via Docker Command
```bash
docker pull lucidfabrics/bitbonsai:latest
docker stop bitbonsai
docker rm bitbonsai
# Run installation command again
```

## Troubleshooting

### Cannot Access Web UI
- Verify port 3000 is not in use: `netstat -tuln | grep 3000`
- Check container logs: `docker logs bitbonsai`
- Ensure firewall allows port 3000

### Scan Not Working
- Verify media path is mounted correctly: `docker exec bitbonsai ls /media`
- Check folder permissions (container runs as user 99:100 by default)
- Review logs for errors: `docker logs bitbonsai`

### Empty Statistics
- Ensure media folders contain video files (.mp4, .mkv, .avi)
- Trigger manual scan via Web UI
- Check that ffprobe can access files

## Support

- **GitHub Issues**: https://github.com/lucidfabrics/bitbonsai/issues
- **Docker Hub**: https://hub.docker.com/r/lucidfabrics/bitbonsai

## Multi-Node Setup with Shared Storage

BitBonsai supports **distributed encoding** across multiple nodes (MAIN + LINKED child nodes). For optimal performance, shared storage should be configured to avoid file transfers.

### Storage Architecture

BitBonsai on Unraid uses **Unraid's native NFS exports** for shared storage:

```
┌──────────────────────────────────────┐
│  Unraid (MAIN Node)                  │
│  ┌────────────────────────────────┐  │
│  │ BitBonsai Container            │  │
│  │  - Detects Docker volumes      │  │
│  │  - Creates storage shares      │  │
│  └────────────────────────────────┘  │
│                                      │
│  Native NFS Exports:                 │
│  • /mnt/user/media → :2049          │
│  • /mnt/user/Downloads → :2049      │
└──────────────────────────────────────┘
           ↓ NFS
┌──────────────────────────────────────┐
│  Child Node (LINKED)                 │
│  ┌────────────────────────────────┐  │
│  │ BitBonsai Agent                │  │
│  │  - Auto-detects NFS exports    │  │
│  │  - Mounts at same paths:       │  │
│  │    • /unraid-media              │  │
│  │    • /media                     │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### Storage Architecture: Two Methods

BitBonsai supports **two storage sharing methods**. The system will automatically recommend the best option based on your environment.

#### Method 1: NFS Shared Storage (Recommended for Local Network)

**Best for**: Same network, bare metal, or privileged containers

**How it works:**
- Main node exports media via NFS
- Child nodes mount NFS shares
- Direct file access (no transfer needed)
- **Instant job start**

**Requirements:**
- ✅ Nodes on same network
- ✅ Child node can mount NFS (privileged mode for LXC/Docker)
- ✅ NFS server enabled on main node

**Pros:**
- Zero file transfer overhead
- Instant encoding start
- Best for large files (50GB+ movies)

**Cons:**
- Requires NFS setup
- LXC containers need privileged mode
- Network I/O during encoding

#### Method 2: rsync File Transfer (Automatic Fallback)

**Best for**: Non-privileged containers, different networks, or when NFS isn't available

**How it works:**
- Files transferred to child node via rsync
- Encoding happens on local disk
- Results transferred back to main node
- **Automatic, no configuration needed**

**Requirements:**
- ✅ SSH access between nodes
- ✅ Temp storage space on child node

**Pros:**
- Works in any container (LXC, Docker, etc.)
- No special privileges needed
- Resumable transfers (can recover from failures)
- Local I/O during encoding (faster FFmpeg)

**Cons:**
- ~1-2 minute transfer time for 10GB file
- Requires temp storage space
- 3-5% overhead on total job time

**Performance Comparison:**

| File Size | NFS Mount Time | rsync Transfer (Gigabit) | Overhead |
|-----------|---------------|-------------------------|----------|
| 5 GB | Instant | ~45 seconds | 3% of 20-min encode |
| 10 GB | Instant | ~90 seconds | 4% of 30-min encode |
| 50 GB | Instant | ~7 minutes | 10% of 60-min encode |

### Auto-Detection & Recommendations

BitBonsai **automatically detects** your environment and recommends the best storage method:

1. **Detects container type**: Bare metal, LXC, Docker, Kubernetes
2. **Checks privileges**: Can mount NFS or not
3. **Analyzes network**: Same subnet or different
4. **Recommends method**: NFS or rsync based on above

**Example Recommendations:**
- ✅ "Use NFS - nodes on same network, both can mount"
- ⚠️ "Use rsync - LXC container without privileges detected"
- ⚠️ "Enable LXC privileged mode for NFS support (see below)"

### Why Unraid's Native NFS?

**BitBonsai does NOT run its own NFS server inside the container** because:
- ❌ Unraid's NFS server already uses ports 111, 2049, etc.
- ❌ Running NFS inside a container conflicts with the host's NFS
- ✅ Unraid's native NFS is already configured and working
- ✅ Better performance with host-level NFS

### Configuring Storage Method

BitBonsai will automatically choose the best method, but you can configure it manually:

1. Go to **Nodes** page
2. Click on a child node
3. Click **Storage** tab
4. See recommended storage method at the top
5. Follow the configuration wizard

#### Step 1: Enable NFS on Unraid (MAIN Node)

1. Go to **Settings** → **NFS**
2. Enable NFS Server: **Yes**
3. Add your media shares to exports:
   ```
   /mnt/user/media *(sec=sys,rw,insecure,anongid=100,anonuid=99,all_squash)
   /mnt/user/Downloads *(sec=sys,rw,insecure,anongid=100,anonuid=99,all_squash)
   ```
4. Click **Apply**

#### Step 2: Configure MAIN Node Storage Shares

The MAIN node's BitBonsai will automatically detect Docker volume mounts, but since Unraid's NFS conflicts with container NFS, you'll need to create shares manually:

1. Go to **Nodes** page in BitBonsai
2. Click **Storage** on the MAIN node
3. Click **Add Share Manually**
4. Add shares pointing to Unraid's exports:
   - **Name**: `Unraid Media`
   - **Protocol**: `NFS`
   - **Server**: `192.168.1.100` (your Unraid IP)
   - **Share Path**: `/mnt/user/media`
   - **Mount Point**: `/unraid-media`

#### Step 3: Configure LINKED Node Storage

On each child node:

1. Go to **Nodes** page
2. Click **Storage** on the child node
3. Click **Auto-Detect Shares**
4. BitBonsai will discover Unraid's NFS exports
5. Click **Mount** to mount each share

**Important**: The mount points should match between MAIN and LINKED nodes:
- MAIN: `/unraid-media` → LINKED: `/unraid-media`
- MAIN: `/media` → LINKED: `/media`

### Verifying Storage Access

After mounting shares on child nodes, verify access:

```bash
# SSH into child node
ssh root@child-node

# Check if mounts are active
mount | grep nfs

# Expected output:
# 192.168.1.100:/mnt/user/media on /unraid-media type nfs
# 192.168.1.100:/mnt/user/Downloads on /media type nfs

# Verify file access
ls /unraid-media/Movies
ls /media
```

### Troubleshooting Storage Issues

#### Jobs Stuck "Encoding" with No Progress

**Symptom**: Jobs assigned to child node timeout after 10 minutes with error "Encoding timed out (no progress for 10min)"

**Cause**: Child node cannot access source files because shared storage is not mounted

**Fix**:
1. Check child node storage: **Nodes** → **Storage** (child node)
2. Verify mounts are active (green checkmark)
3. If no shares exist, click **Auto-Detect Shares**
4. Mount any unmounted shares
5. Jobs will automatically retry and resume

#### Auto-Detect Finds No Shares

**Cause**: Unraid's NFS server is not running or not exporting the right paths

**Fix**:
1. Check Unraid NFS status: **Settings** → **NFS**
2. Verify NFS Server is **Enabled**
3. Check exports: `showmount -e YOUR_UNRAID_IP`
4. Restart NFS: **Settings** → **NFS** → **Stop** → **Start**

#### Permission Denied Errors

**Cause**: NFS export permissions don't allow the container user (uid 99, gid 100)

**Fix**:
1. Update NFS exports to include `anonuid=99,anongid=100,all_squash`
2. Or use `no_root_squash` for testing (less secure)
3. Restart NFS server after changes

### Performance Considerations

**With Shared Storage (NFS)**:
- ✅ **No file transfers** - instant job start
- ✅ **Direct access** - child node reads from Unraid
- ✅ **Faster overall** - network I/O during encoding only
- ⚠️ Network bandwidth required during encoding

**Without Shared Storage**:
- ❌ **File transfer required** - copy entire file first
- ❌ **Slower start** - wait for transfer to complete
- ❌ **2x network traffic** - transfer + return result
- ✅ Local I/O during encoding (faster if transfer completes)

**Recommendation**: Always use shared storage for files > 5GB

## LXC Container Configuration for NFS

If your child node is running in an LXC container (Proxmox), you need to enable **privileged mode** to allow NFS mounting.

### Method 1: Enable Privileged Mode (Recommended for dedicated encoding nodes)

**Via Proxmox Web UI:**
1. Stop the LXC container
2. Go to **Datacenter** → **Your Node** → **Container ID**
3. Click **Options** tab
4. Double-click **Privileged** → Set to **Yes**
5. Click **OK**
6. Start the container

**Via Command Line (Proxmox host):**
```bash
# Stop container
pct stop <container-id>

# Edit config
nano /etc/pve/lxc/<container-id>.conf

# Add this line:
unprivileged: 0

# Save and start
pct start <container-id>
```

**Security Note:** Privileged mode gives the container root access to the host. Only use for trusted applications on isolated networks.

### Method 2: Mount NFS on Proxmox Host (More Secure)

Instead of privileged mode, mount NFS on the Proxmox host and bind-mount into the container:

**Step 1: Mount NFS on Proxmox Host**
```bash
# SSH to Proxmox host
ssh root@pve-host

# Install NFS client
apt-get install nfs-common

# Create mount point
mkdir -p /mnt/unraid-media

# Mount NFS share
mount -t nfs 192.168.1.100:/mnt/user/media /mnt/unraid-media

# Verify mount
df -h | grep unraid-media

# Add to /etc/fstab for persistent mount
echo "192.168.1.100:/mnt/user/media /mnt/unraid-media nfs defaults 0 0" >> /etc/fstab
```

**Step 2: Bind-Mount into LXC Container**
```bash
# Stop container
pct stop <container-id>

# Edit config
nano /etc/pve/lxc/<container-id>.conf

# Add bind mount (mp0 = mount point 0)
mp0: /mnt/unraid-media,mp=/unraid-media

# Save and start
pct start <container-id>
```

**Step 3: Verify in Container**
```bash
# Enter container
pct enter <container-id>

# Check mount
ls /unraid-media/Movies
```

### Method 3: Use rsync File Transfer (No Configuration)

If you don't want to configure NFS or privileged mode:

1. Go to **Nodes** page in BitBonsai
2. Click on child node → **Storage** tab
3. System will detect LXC and recommend **rsync**
4. Set `hasSharedStorage: false` on the node
5. Jobs will automatically transfer files via rsync

**Performance:** 3-5% overhead, but works anywhere!

## Verifying Storage Configuration

After setup, verify your configuration:

1. **Check environment detection:**
   ```bash
   curl http://child-node-ip:3100/api/v1/nodes/environment
   ```

2. **Check storage recommendation:**
   ```bash
   curl -X POST http://main-node:3100/api/v1/nodes/storage-recommendation \
     -H 'Content-Type: application/json' \
     -d '{"sourceNodeId":"main-id","targetNodeId":"child-id"}'
   ```

3. **Test encoding job:**
   - Assign a small test job to child node
   - Watch for "TRANSFERRING" stage (if using rsync)
   - Or instant "ENCODING" start (if using NFS)

## Version History

- **0.2.0** (Current)
  - Multi-node distributed encoding
  - Shared storage via Unraid native NFS
  - Auto-detection of NFS exports
  - Job delegation and recovery

- **0.1.0** (Initial Release)
  - Basic media scanning
  - Codec distribution analysis
  - Storage statistics
  - Angular 19 + NestJS architecture

---

**Made with ❤️ by Lucid Fabrics**
