# Hybrid Multi-Node Architecture - Testing Guide

## Quick Testing Checklist

### Prerequisites
- ✅ Main node running at 192.168.1.100:4210 (Unraid)
- ✅ LXC child node available at 192.168.1.61:3000
- ✅ Both nodes on same network (192.168.1.0/24)
- ✅ Phase 1 backend deployed and running

---

## Test Scenario 1: Complete Child Node Setup Flow

### 1. Start LXC Child Node

```bash
# SSH into Proxmox host
ssh -i ~/.ssh/pve_ai_key root@192.168.1.5

# Start LXC container (if not running)
pct start 100

# Access child node
pct enter 100

# Verify BitBonsai is running
pm2 list
# Should show: bitbonsai-backend (online)

# Check child node URL
curl http://192.168.1.61:3000/api/v1/health
# Should return: {"status":"ok"}
```

### 2. Access Child Node Setup Wizard

```bash
# Open browser to child node
open http://192.168.1.61:3000/node-setup
```

**Expected UI**: Welcome screen with "Connect to Main Node" title

### 3. Choose Auto-Discovery

Click **"Auto-Discover"** button

**Expected**:
- Animated scanning screen (5 seconds)
- Discovers main node at 192.168.1.100
- Shows: "BitBonsai Main" (or custom name)

### 4. Select Main Node and Name Child

- Select discovered main node
- Enter child node name: `"LXC Child 1"`
- Click **"Request Connection"**

**Expected**:
- Shows 6-digit pairing code (e.g., "123456")
- Status: "Waiting for approval..."
- Timer starts counting elapsed time

### 5. Approve on Main Node

```bash
# Open main node in another browser tab
open http://192.168.1.100:4210/pending-requests
```

**Expected**:
- Bell icon shows (1) pending request
- Request shows:
  - Child Node Name: "LXC Child 1"
  - IP Address: 192.168.1.61
  - Hostname: lxc-bitbonsai
  - Hardware: 12 cores, 32GB RAM

Click **"Approve"** button

### 6. Observe Capability Testing (Child Node)

**Expected on child node browser**:

**Automatic transition to Capability Test screen** with:

```
Detecting Node Capabilities
Running comprehensive compatibility tests...

Progress Bar: [████████████████████████░░░░░░] 75%

Test Phases:
✅ Network Connection          (Latency: 3ms)
✅ Shared Storage Access       (Accessible at /mnt/media)
✅ Hardware Detection          (12 cores, 32GB RAM)
🔵 Network Type Classification (In progress...)

Current: Classifying network type...
```

### 7. Review Capability Results

**Expected**:

**For LOCAL + Shared Storage**:

```
┌─────────────────────────────────────────┐
│   🚀 OPTIMIZED SETUP                    │
│   Local High-Speed Node                 │
│   Optimal configuration for maximum     │
│   performance                           │
└─────────────────────────────────────────┘

┌──────────────┬──────────────┬──────────────┬──────────────┐
│ Network Loc  │ Shared Stor  │ Latency      │ IP Type      │
│ LOCAL        │ Enabled      │ 3ms          │ Private      │
│              │ /mnt/media   │              │              │
└──────────────┴──────────────┴──────────────┴──────────────┘

💡 Configuration Analysis:
   Local network node (private IP: yes, latency: 3ms).
   Direct shared storage access enabled - jobs will use
   zero-copy file access (optimal performance).

⚙️ Node Configuration:
   Max Concurrent Jobs: [2]
   CPU Limit (%):      [80]

✅ Zero-Copy Encoding Enabled
   This node can access files directly from the main
   node's storage. No file transfers required - encoding
   will start immediately!
```

**For REMOTE nodes** (if testing over VPN):

```
┌─────────────────────────────────────────┐
│   🌐 REMOTE SETUP DETECTED              │
│   Remote Network Node                   │
│   File transfers required for jobs      │
└─────────────────────────────────────────┘

⚠️ Remote Node Performance Notice
   • Estimated transfer time for 10GB file: 15-30 minutes
   • Consider using VPN or shared storage
   • Jobs routed to local nodes when available
```

### 8. Complete Setup

Click **"Complete Setup"** button

**Expected**:
- Transitions to completion screen
- Shows hardware summary
- "Start Encoding" button appears

Click **"Start Encoding"**

**Expected**:
- Navigates to `/queue` page
- Child node is now fully operational

---

## Test Scenario 2: Verify Node in Dashboard

### 1. Check Main Node Dashboard

```bash
open http://192.168.1.100:4210/nodes
```

**Expected**:

```
Nodes Dashboard

┌─────────────────────────────────────────────────────┐
│ 🚀 LOCAL HIGH-SPEED          LXC Child 1     ONLINE │
│                                                     │
│ 📊 3ms latency   💾 Shared Storage   🔧 12 cores  │
│                                                     │
│ Max Workers: 2/2   CPU Limit: 80%                  │
└─────────────────────────────────────────────────────┘
```

**Visual Indicators**:
- ✅ Green border (LOCAL node)
- ✅ "LOCAL HIGH-SPEED" badge (green)
- ✅ Shared storage icon
- ✅ Latency displayed: "3ms"
- ✅ ONLINE status

### 2. Check Node Details

Click on **"LXC Child 1"** card

**Expected**:
- Modal/page opens with full node details
- Shows all capability fields:
  - Network Location: LOCAL
  - Has Shared Storage: Yes
  - Storage Base Path: /mnt/media
  - Latency: 3ms
  - CPU Cores: 12
  - RAM: 32GB
  - Max Transfer Size: 50000 MB

---

## Test Scenario 3: Job Distribution (Future Phase 4)

### Prerequisites
- At least 2 nodes online (main + child)
- Test media files available

### 1. Create Test Jobs

```bash
# Create 5 test jobs via API or UI
curl -X POST http://192.168.1.100:3100/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "libraryId": "lib123",
    "filePath": "/mnt/media/test.mkv",
    "encodingPolicyId": "policy123"
  }'
```

### 2. Observe Job Assignment

**Expected**:
- Jobs assigned to nodes based on scoring algorithm
- LOCAL + Shared Storage nodes get priority
- Load balancing across nodes

**Check job assignment**:
```bash
# View jobs assigned to child node
curl http://192.168.1.100:3100/api/v1/jobs?nodeId=<child-node-id>
```

---

## Test Scenario 4: Capability Re-Test

### 1. Manually Trigger Capability Test

```bash
# Call test endpoint
curl -X POST http://192.168.1.100:3100/api/v1/nodes/<node-id>/test-capabilities
```

**Expected Response**:
```json
{
  "nodeId": "clxyz...",
  "nodeName": "LXC Child 1",
  "networkLocation": "LOCAL",
  "hasSharedStorage": true,
  "storageBasePath": "/mnt/media",
  "latencyMs": 3,
  "bandwidthMbps": null,
  "isPrivateIP": true,
  "reasoning": "Local network node...",
  "tests": {
    "networkConnection": {
      "status": "success",
      "message": "Latency: 3ms",
      "details": { "latencyMs": 3, "isPrivateIP": true }
    },
    "sharedStorage": {
      "status": "success",
      "message": "Accessible at /mnt/media",
      "details": { "hasSharedStorage": true }
    }
  }
}
```

---

## Expected Test Results Summary

| Test | Expected Outcome | Status |
|------|------------------|--------|
| Child node discovery | Finds main node in 5s | ⏳ Pending |
| Pairing request | Shows 6-digit code | ⏳ Pending |
| Approval flow | Admin approves on main node | ⏳ Pending |
| Capability test | 4 phases animate smoothly | ⏳ Pending |
| LOCAL detection | Classified as LOCAL | ⏳ Pending |
| Shared storage | Detected as enabled | ⏳ Pending |
| Latency | Measured < 10ms | ⏳ Pending |
| Results screen | Green "OPTIMIZED SETUP" banner | ⏳ Pending |
| Configuration | Can edit maxWorkers, cpuLimit | ⏳ Pending |
| Completion | Setup finishes successfully | ⏳ Pending |
| Node dashboard | Shows "LOCAL HIGH-SPEED" badge | ⏳ Pending |

---

## Troubleshooting

### Issue: Capability test gets stuck at 25%

**Diagnosis**:
```bash
# Check backend logs
ssh root@unraid 'docker logs -f bitbonsai-backend'

# Look for errors during capability detection
grep -i "capability" /mnt/user/appdata/bitbonsai-dev/logs/backend.log
```

**Common Causes**:
- Backend API not responding
- Child node ID not found in database
- Network connectivity issues

**Fix**:
```bash
# Restart backend container
ssh root@unraid 'docker restart bitbonsai-backend'

# Verify node exists in database
ssh root@unraid 'docker exec bitbonsai-backend npx prisma studio'
```

### Issue: Node shows UNKNOWN network location

**Diagnosis**:
```bash
# Check node record in database
curl http://192.168.1.100:3100/api/v1/nodes/<node-id> | jq
```

**Common Causes**:
- Latency measurement failed
- IP address not detected
- Capability detection didn't run

**Fix**:
- Re-run capability test manually
- Check ping command works: `ping -c 3 192.168.1.61`
- Verify IP is in private range (192.168.x.x)

### Issue: Shared storage not detected

**Diagnosis**:
```bash
# Check MEDIA_PATHS environment variable on main node
ssh root@unraid 'docker exec bitbonsai-backend env | grep MEDIA'

# Verify paths are accessible
ssh root@unraid 'docker exec bitbonsai-backend ls -la /mnt/media'
```

**Common Causes**:
- MEDIA_PATHS not configured
- Path doesn't exist or not mounted
- Permission issues

**Fix**:
```bash
# Update docker-compose.unraid.yml
environment:
  - MEDIA_PATHS=/mnt/user/media

# Restart backend
ssh root@unraid 'docker restart bitbonsai-backend'
```

---

## Performance Benchmarks

### Expected Latency Values

| Network Type | Expected Latency | Classification |
|--------------|------------------|----------------|
| Same LAN | 1-10ms | LOCAL |
| VPN | 10-50ms | LOCAL (slow) |
| Internet | 50-500ms | REMOTE |

### Expected Storage Test Results

| Storage Type | Test Result | Shared Storage? |
|--------------|-------------|-----------------|
| NFS mount | Success | ✅ Yes |
| CIFS mount | Success | ✅ Yes |
| Docker volume | Success | ✅ Yes |
| No mount | Failed | ❌ No |

---

## Next Steps After Testing

1. ✅ Verify all tests pass
2. 📸 Take screenshots of key screens
3. 📊 Record performance metrics
4. 🐛 Document any bugs found
5. ✍️ Update test results in this document
6. 🚀 Proceed to Phase 4 implementation

---

**Testing Guide Version**: 1.0.0
**Last Updated**: November 10, 2025
**Tested By**: _[Your Name]_
**Test Date**: _[Date]_
**Test Environment**: Unraid (192.168.1.100) + LXC (192.168.1.61)
