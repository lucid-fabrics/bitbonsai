# BitBonsai Marketing Features - bitbonsai.io

**Purpose:** Complete feature inventory for marketing website to showcase product capabilities.

---

## 🎯 VALUE PROPOSITION

**Main Hook:**
> "Intelligent multi-node video encoding that reduces storage by 40-60% with zero friction. Self-healing, distributed, and built for Plex/Jellyfin servers."

**Problem → Solution:**
- 4K libraries eating disk space → Automatic HEVC/AV1 conversion
- Crashes losing hours of progress → TRUE RESUME from exact timestamp
- Complex configuration hell → Zero-config smart defaults
- Manual crash recovery → 4-layer auto-healing system
- Single-node bottleneck → Distributed multi-node architecture

---

## 🏆 HERO FEATURES (Above-the-fold)

| Feature | Marketing Copy | Visual Hook |
|---------|----------------|-------------|
| **TRUE RESUME™** | "Crash at 98%? Resume at 98%. Not 0%." | Progress bar jumping back to 98% after crash |
| **Auto-Healing** | "Self-recovers from crashes. Zero manual intervention." | Red error → auto-retry → green success animation |
| **Zero Configuration** | "Point at your library. We handle the rest." | 3-step setup: connect → scan → encode |
| **Multi-Node Distribution** | "Turn 2 weeks into 2 days. Scale across servers." | Single server → 5 nodes parallel encoding visual |
| **Storage Savings** | "Same quality. Half the size." | File size: 50GB → 22GB comparison |

---

## 💎 CORE FEATURES (Feature Grid Section)

### **Encoding Intelligence**
- ✅ Smart codec detection (H.264, HEVC, AV1, VP9)
- ✅ Hardware acceleration (NVIDIA, Intel QSV, AMD, Apple Silicon)
- ✅ Container compatibility checks (AC3 + MP4 warnings)
- ✅ Codec remux optimization (instant "encode" if already target codec)
- ✅ Live preview during encoding
- ✅ Keep original option (backup until confident)

### **Queue Management**
- ✅ 3-tier priority system (Normal, High, Top)
- ✅ Batch operations (cancel all, retry failed, clear completed)
- ✅ Advanced filtering (status, node, library, codec, search)
- ✅ Server-side pagination (handles 1000+ files)
- ✅ Job history timeline (full audit trail)
- ✅ Codec match skip (bulk-complete already-encoded files)

### **Library Organization**
- ✅ Multiple libraries (Movies, TV, Anime, other)
- ✅ Smart policies (Balanced HEVC, Fast HEVC, Quality AV1)
- ✅ File blacklisting (never auto-encode)
- ✅ Ready files caching (5-min cache, tunable)
- ✅ Health-check system (pre-encode file validation)

### **Reliability**
- ✅ Exponential backoff retry (3 max attempts)
- ✅ Stuck job watchdog (detects frozen jobs)
- ✅ CORRUPTED job re-validation (hourly auto-recovery)
- ✅ Orphaned job detection (startup recovery)
- ✅ Atomic file replacement (crash-safe)

---

## 🌐 MULTI-NODE DISTRIBUTION (Premium Section)

**Tagline:** "Enterprise-grade workload balancing. Homelab pricing."

### **Distribution v2 Algorithm**
| Feature | Benefit |
|---------|---------|
| **11-Factor Scoring** | Intelligent job assignment (not dumb round-robin) |
| **Real-Time Load Monitoring** | CPU, memory, queue depth tracked every 10s |
| **ETA-Based Balancing** | All nodes finish at same time (no idle workers) |
| **Job Stickiness** | Prevents ping-ponging between nodes (5-min lock) |
| **Reliability Tracking** | Bad nodes get fewer jobs automatically (24h failure rate) |
| **Hardware Affinity** | GPU jobs → GPU nodes automatically |
| **Library Affinity** | Local jobs prioritized (faster starts) |
| **Per-Node Scheduling** | Encode off-peak hours only (8pm-6am) |
| **Load Throttling** | Pauses jobs when thresholds exceeded |
| **Fast SSD Temp Cache** | 10-100x faster encoding vs HDD |

### **Zero-Config Node Discovery**
- **mDNS Auto-Discovery**: Workers announce themselves (Bonjour/Avahi)
- **Manual Pairing**: 6-digit token for VLANs/VPNs
- **SSH Key Auto-Exchange**: One-click passwordless auth
- **Storage Auto-Detection**: NFS/SMB mount verification
- **Hybrid Architecture**: Shared storage (NFS) or file transfer (rsync)

---

## 🛠️ AUTO-HEALING SYSTEM (Trust-Building Section)

**Tagline:** "The encoder that never gives up."

### **4-Layer Recovery**
1. **Initial Delay (2s)**: Container startup time
2. **Volume Mount Probing (10 retries × 1s)**: Docker/Unraid mount wait
3. **Stabilization Delay (3s)**: NFS/FUSE settling
4. **Temp File Validation (10 retries × 2s)**: Verify partial encodes exist

### **Self-Healing Scenarios**
| Scenario | Auto-Recovery Action |
|----------|---------------------|
| Container restarts | Resume from exact timestamp |
| NFS mount delay | Wait 20s with exponential backoff |
| Job orphaned (stuck ENCODING) | Reset to QUEUED on startup |
| Encoding crashes | 3 automatic retries with delays |
| File marked CORRUPTED | Hourly re-validation, auto-requeue if fixed |
| Job frozen (no progress 5+ min) | Watchdog auto-restarts |
| Node unreliable (high failure rate) | Fewer jobs assigned automatically |

---

## 🔗 INTEGRATIONS (Ecosystem Section)

**Tagline:** "Plays nice with your entire media stack."

### **Fully Integrated**
| Service | Features |
|---------|----------|
| **Jellyfin** | Auto-refresh libraries, find renamed files, file path search |
| **Plex** | Auto-pause during playback, library refresh, session monitoring |
| **qBittorrent** | Skip files being seeded |
| **Transmission** | Skip files being seeded |
| **Deluge** | Skip files being seeded |

### **Partial Integration**
- **Radarr/Sonarr/Whisparr**: Quality profile checks, skip if quality met

### **Coming Soon**
- Discord/Slack webhooks
- Email (SMTP) notifications
- Generic webhooks with signature verification

---

## 💳 PRICING TIERS (Pricing Page)

### **Patreon Tiers** (Community Support)

| Tier | Price | Max Nodes | Max Concurrent Jobs | Best For |
|------|-------|-----------|---------------------|----------|
| **FREE** | $0/mo | 1 node | 2 concurrent | Testing, small libraries (< 500 files) |
| **Supporter** | $3/mo | 2 nodes | 3 concurrent | Home users, 1-2 servers |
| **Plus** | $5/mo | 3 nodes | 5 concurrent | Homelab enthusiasts |
| **Pro** | $10/mo | 5 nodes | 10 concurrent | Power users, multi-server setups |
| **Ultimate** | $20/mo | 10 nodes | 20 concurrent | Data hoarders, large libraries (5000+ files) |

### **Commercial Tiers** (Stripe - Coming Soon)

| Tier | Features | Target Audience |
|------|----------|-----------------|
| **Starter** | Basic multi-node, community support | Small teams, media agencies |
| **Pro** | Advanced features, priority support | Production environments |
| **Enterprise** | Unlimited nodes/jobs, SLA, custom integrations | Large organizations, MSPs |

### **Feature Flags by Tier**
- Node limits enforced via license validation
- Concurrent job limits per tier
- Patreon OAuth auto-activation
- Stripe customer/subscription tracking
- Unique license keys per user

---

## 🎯 COMPETITIVE ADVANTAGES (vs Tdarr/FileFlows)

| Feature | BitBonsai | Tdarr/FileFlows |
|---------|-----------|-----------------|
| **Setup Complexity** | Zero plugins, 5-min setup | 47+ plugins to configure |
| **Resume After Crash** | TRUE RESUME (exact timestamp) | Restart from 0% |
| **Crash Recovery** | Auto-heal (4-layer) | Manual retry |
| **UI/UX** | Clean, minimal, intuitive | Complex, overwhelming |
| **Multi-Node** | Distributed, load-balanced | Single machine |
| **Default Behavior** | Smart defaults, works out-of-box | Requires tuning |
| **Error Handling** | Decision-Required UX (asks for help) | Silent failures |
| **Scheduling** | Per-node time windows | No time controls |
| **Resource Management** | Load throttling, auto-pauses | Can crush servers |

---

## 📊 KEY METRICS (Social Proof Section)

**Storage Savings:**
- 40-60% reduction (H.264 → HEVC typical)
- 50-70% reduction (H.264 → AV1 coming soon)

**Performance:**
- 10-100x faster encoding with SSD temp cache vs HDD
- 5-minute setup from Docker pull to first encode
- 10-second polling for real-time node health

**Reliability:**
- Zero manual intervention for crash recovery
- 24-hour failure rate tracking per node
- 11-factor scoring algorithm for distribution

---

## 💡 PAIN POINTS SOLVED (Problem-Agitate-Solve Section)

### **Problem 1: Storage Crisis**
**Pain:** "My 4K library is 50GB per movie - I'm out of disk space!"
**Solution:** Automatic HEVC/AV1 conversion reduces files to 20-30GB with same quality.

### **Problem 2: Crash Anxiety**
**Pain:** "Tdarr crashed at 98% - lost 12 hours of encoding!"
**Solution:** TRUE RESUME picks up at 98%, not 0%. Progress saved every 10 seconds.

### **Problem 3: Configuration Hell**
**Pain:** "I've been configuring plugins for 3 days and it still doesn't work."
**Solution:** Zero plugins. Smart defaults. Works out-of-box in 5 minutes.

### **Problem 4: Manual Babysitting**
**Pain:** "I have to manually retry failed jobs every morning."
**Solution:** 4-layer auto-healing. Self-recovers from crashes. Hourly CORRUPTED job re-validation.

### **Problem 5: Single-Node Bottleneck**
**Pain:** "My server takes 2 weeks to encode my library."
**Solution:** Multi-node distribution. Turn 2 weeks into 2 days by scaling across servers.

### **Problem 6: Compatibility Issues**
**Pain:** "My files won't play after encoding - wrong container?"
**Solution:** Container compatibility checks. Warns about AC3 + MP4, suggests remux to MKV.

### **Problem 7: Resource Overload**
**Pain:** "Encoding crushed my server - Plex streams stuttered."
**Solution:** Load throttling, auto-pauses when thresholds exceeded. Per-node scheduling for off-peak hours.

---

## 🎨 MARKETING TAGLINES

**Primary:**
- "Trim your library. Not your quality."
- "The encoder that never gives up."
- "Zero plugins. Zero config. Just results."

**Feature-Specific:**
- "Crash at 98%? Resume at 98%." (TRUE RESUME)
- "Distributed encoding that just works." (Multi-Node)
- "Your media library, half the size, same quality." (Storage Savings)
- "Self-healing video encoding for the self-hosted community." (Auto-Healing)

---

## 🎯 TARGET AUDIENCE

### **Primary**
- Plex/Jellyfin/Emby users with large libraries (500+ files)
- Homelab enthusiasts with multi-server setups
- r/DataHoarder community optimizing storage
- Unraid users (official Community Apps integration)

### **Secondary**
- Media production teams encoding dailies/proxies
- Content creators batch-processing video libraries
- SMBs with video asset management needs

---

## 📸 VISUAL CONTENT IDEAS (Screenshots/Mockups Needed)

### **Hero Section**
1. Dashboard showing multi-node encoding (5 nodes, progress bars)
2. TRUE RESUME demo: crash → auto-resume at 98% animation
3. Before/After storage comparison (50GB → 22GB)

### **Feature Sections**
4. Clean queue UI (filtering, batch operations, status colors)
5. Library management (multiple libraries, policies)
6. Node management dashboard (load graphs, health status)
7. Integration cards (Jellyfin, Plex, qBittorrent logos)

### **Technical Sections**
8. Distribution v2 algorithm visualization (job assignment flow)
9. Auto-healing flowchart (4-layer recovery)
10. Hardware acceleration icons (NVIDIA, Intel, AMD, Apple)

### **Comparison Section**
11. Side-by-side BitBonsai vs Tdarr UI screenshots
12. Setup complexity comparison (1 screen vs 10 screens)

### **Testimonials** (Future)
13. User quotes with storage savings metrics
14. Before/After library size graphs

---

## 🚀 TECHNICAL INNOVATIONS (For Tech-Savvy Audience)

1. **TRUE RESUME Algorithm**: Progress saved every 10s at HH:MM:SS.MS precision
2. **4-Layer Auto-Heal**: Docker/Unraid/K8s/NFS mount recovery
3. **Distribution v2 Scoring**: ETA-balancing + reliability + hardware affinity
4. **Job Stickiness Anti-Flapping**: 5-min lock prevents job migration
5. **Decision-Required UX**: Pauses for user input vs silent failure
6. **Hybrid Architecture**: NFS shared storage or SSH file transfer (auto-detects)
7. **Self-Healing File Relocation**: Jellyfin API integration finds renamed files
8. **Container Environment Detection**: Auto-detects Docker/LXC/bare metal

---

## 📝 CALL-TO-ACTION VARIATIONS

**Primary CTA:**
- "Start Encoding in 5 Minutes" → Docker install docs
- "Try Free (No Credit Card)" → Free tier signup
- "See Live Demo" → Interactive demo or video walkthrough

**Secondary CTA:**
- "Join Discord Community" → Discord invite
- "Read Documentation" → Docs site
- "Compare to Tdarr" → Comparison page

**Tertiary CTA:**
- "Support on Patreon" → Patreon page
- "Star on GitHub" → GitHub repo
- "View Pricing" → Pricing page

---

## 🎬 VIDEO CONTENT IDEAS

1. **60-Second Hero Video**: Multi-node encoding demo, TRUE RESUME crash recovery, storage savings reveal
2. **5-Minute Walkthrough**: Setup → scan library → configure policy → watch jobs encode
3. **Feature Spotlights** (15-30s each): TRUE RESUME, Auto-Healing, Multi-Node, Integrations
4. **Comparison Video**: BitBonsai vs Tdarr side-by-side setup process
5. **Testimonial Reels**: User interviews showing storage savings, time savings

---

## 📈 SUCCESS METRICS TO HIGHLIGHT

- "Used by [X] homelab enthusiasts" (Docker Hub pulls?)
- "[X] TB encoded and counting" (telemetry opt-in?)
- "Featured in Unraid Community Apps"
- "[X]★ on GitHub"
- "Active community on Discord ([X] members)"

---

**End of Feature Inventory**

This document contains everything extractable from the codebase for marketing purposes. Next steps:
1. Create website structure based on these features
2. Write copy for each section
3. Design mockups/wireframes
4. Plan screenshot/video production
