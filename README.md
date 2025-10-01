# BitBonsai 🌳

> **Self-hosted media optimizer with zero plugins and beautiful UX**

<div align="center">

[![Docker Pulls](https://img.shields.io/docker/pulls/lucidfabrics/bitbonsai?style=flat-square)](https://hub.docker.com/r/lucidfabrics/bitbonsai)
[![Version](https://img.shields.io/github/v/release/lucidfabrics/bitbonsai?style=flat-square)](https://github.com/lucidfabrics/bitbonsai/releases)
[![License](https://img.shields.io/badge/license-Dual%20(MIT%2FCommercial)-blue?style=flat-square)](#license)

**Transform your chaotic media library into a perfectly pruned digital garden.**

[Quick Start](#quick-start) • [Features](#features) • [Pricing](#pricing-) • [Documentation](#documentation)

</div>

---

## What is BitBonsai?

BitBonsai is a **professional-grade media automation platform** that turns your scattered video collection into an organized, optimized library. Unlike bloated alternatives that require dozens of plugins and complex configurations, BitBonsai works **out of the box** with everything built-in.

Think of it as a media server's best friend:
- **Automated encoding** to modern codecs (HEVC, AV1)
- **Zero-plugin architecture** - everything just works
- **Beautiful, calming UI** inspired by Japanese bonsai philosophy
- **Multi-node distributed processing** for massive libraries
- **Intelligent policy system** that learns your preferences
- **Environment-aware setup** for Unraid, Docker, Kubernetes

### Why BitBonsai?

**Traditional media tools are a nightmare:**
- Unmanic requires 47 plugins and 200 config options
- Tdarr has a confusing UI and limited codec support
- HandBrake is manual and non-scalable
- Commercial solutions cost $500+/year for basic features

**BitBonsai is different:**
- ✅ Install once, works forever
- ✅ Beautiful UI you'll actually enjoy using
- ✅ Smart defaults that work for 95% of users
- ✅ Scale from single node to 100+ nodes (commercial tier)
- ✅ Fair pricing: free for home use, affordable for professionals

---

## Features

### Core Features (All Tiers)

| Feature | Description |
|---------|-------------|
| 🎬 **Zero-Plugin Architecture** | All codecs, containers, and filters built-in. No plugin hunting. |
| 📊 **Beautiful Analytics Dashboard** | Real-time insights into codec distribution, storage savings, and encoding progress |
| 🎨 **Calming, Professional UI** | Inspired by bonsai minimalism - clean, fast, and stress-free |
| 🔄 **Smart Policy System** | Create encoding rules once, apply to entire library automatically |
| ⚡ **Live Progress Tracking** | Watch your library transform in real-time with WebSocket updates |
| 🎯 **Codec Intelligence** | Automatic detection of H.264, H.265/HEVC, AV1, VP9, and legacy codecs |
| 💾 **Storage Optimization** | See potential space savings before encoding (typical: 40-60% reduction) |
| 🔒 **Privacy-First** | Self-hosted, no telemetry, no phone-home |
| 🐳 **Docker Native** | One-command deployment for Unraid, Docker, Kubernetes |
| 📱 **Responsive Design** | Manage your library from desktop, tablet, or mobile |

### Commercial Features

| Feature | Free | Patreon | Starter | Pro | Enterprise |
|---------|------|---------|---------|-----|------------|
| **Nodes** | 1 | 1 | 3 | 10 | Unlimited |
| **Concurrent Jobs** | 5 | 10 | 50 | Unlimited | Unlimited |
| **Database** | SQLite | SQLite | PostgreSQL | PostgreSQL | PostgreSQL |
| **Job Queue** | In-Memory | In-Memory | Redis/BullMQ | Redis/BullMQ | Redis/BullMQ |
| **Distributed Encoding** | ❌ | Limited (2 files/child) | ✅ | ✅ | ✅ |
| **Priority Support** | ❌ | ❌ | Email (48h) | Email (24h) | Slack/Phone (4h) |
| **Custom Policies** | 3 | 5 | Unlimited | Unlimited | Unlimited |
| **Advanced Analytics** | ❌ | ✅ | ✅ | ✅ | ✅ |
| **API Access** | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Hardware Encoding** | CPU | CPU+GPU | CPU+GPU | CPU+GPU | CPU+GPU |
| **SSO/LDAP** | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Pricing 💰

### Free Tier (MIT License)
**Perfect for home media servers**

- ✅ Single node encoding
- ✅ Up to 5 concurrent jobs
- ✅ SQLite database
- ✅ All core features
- ✅ Community support via GitHub

**[Get Started Free](#quick-start)**

---

### Patreon Supporter ($5/month)
**Support development, get early access**

- ✅ Everything in Free
- ✅ 10 concurrent jobs
- ✅ Multi-node support (2 files per child node)
- ✅ Advanced analytics dashboard
- ✅ Priority feature requests
- ✅ Early access to new features (7 days before release)

**[Support on Patreon →](https://patreon.com/lucidfabrics)**

---

### Commercial Licenses
**For professional use, businesses, and power users**

#### Starter License - $29/year
**Perfect for growing libraries**

- ✅ 3 encoding nodes
- ✅ 50 concurrent jobs
- ✅ PostgreSQL database
- ✅ Redis/BullMQ job queue
- ✅ Full distributed encoding
- ✅ API access
- ✅ Email support (48h response)
- ✅ Commercial use allowed

**[Purchase Starter License →](https://buy.lucidfabrics.com/bitbonsai/starter)**

---

#### Professional License - $99/year
**For serious media enthusiasts and small teams**

- ✅ 10 encoding nodes
- ✅ Unlimited concurrent jobs
- ✅ PostgreSQL + Redis/BullMQ
- ✅ Hardware encoding (NVENC, QuickSync, AMF)
- ✅ Advanced scheduling (off-peak encoding)
- ✅ Webhook integrations
- ✅ Email support (24h response)
- ✅ Commercial use allowed

**[Purchase Pro License →](https://buy.lucidfabrics.com/bitbonsai/pro)**

---

#### Enterprise License - $299/year
**For businesses, data centers, and large-scale operations**

- ✅ Unlimited encoding nodes
- ✅ Unlimited concurrent jobs
- ✅ High-availability PostgreSQL cluster
- ✅ SSO/LDAP authentication
- ✅ Custom encoding profiles
- ✅ White-label UI (optional)
- ✅ Slack/Phone support (4h response)
- ✅ SLA guarantees
- ✅ Dedicated account manager
- ✅ Commercial use allowed

**[Contact Sales →](mailto:sales@lucidfabrics.com)**

---

### Volume Discounts

**Multiple licenses?** Contact us for:
- 5-10 licenses: 15% discount
- 11-25 licenses: 25% discount
- 26+ licenses: 35% discount + custom support

---

## Quick Start

### Docker (Recommended)

```bash
# Free tier - Single node
docker run -d \
  --name=bitbonsai \
  --restart=unless-stopped \
  -p 3000:3000 \
  -e TZ=America/New_York \
  -v /mnt/user/media:/media \
  -v /mnt/user/appdata/bitbonsai:/data \
  lucidfabrics/bitbonsai:latest
```

Access BitBonsai at `http://localhost:3000`

### Docker Compose

```yaml
version: '3.8'

services:
  bitbonsai:
    image: lucidfabrics/bitbonsai:latest
    container_name: bitbonsai
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - TZ=America/New_York
      - LICENSE_KEY=${LICENSE_KEY:-free}  # Add your license key here
    volumes:
      - /mnt/user/media:/media              # Your media library
      - /mnt/user/appdata/bitbonsai:/data   # BitBonsai database
    devices:
      - /dev/dri:/dev/dri  # For hardware encoding (Intel QuickSync)
```

### Unraid

1. Open Unraid WebUI → **Apps** tab
2. Search for **"BitBonsai"**
3. Click **Install**
4. Configure media paths
5. Add license key (if commercial)
6. Click **Apply**

Access via Unraid dashboard or `http://YOUR_SERVER_IP:3000`

### Adding Encoding Nodes (Commercial Tier)

```bash
# Master node (already running)
# ...

# Child node 1
docker run -d \
  --name=bitbonsai-worker-1 \
  --restart=unless-stopped \
  -e MASTER_URL=http://bitbonsai-master:3000 \
  -e NODE_TYPE=worker \
  -e LICENSE_KEY=your-commercial-key \
  -v /mnt/user/media:/media \
  lucidfabrics/bitbonsai-worker:latest

# Child node 2
docker run -d \
  --name=bitbonsai-worker-2 \
  --restart=unless-stopped \
  -e MASTER_URL=http://bitbonsai-master:3000 \
  -e NODE_TYPE=worker \
  -e LICENSE_KEY=your-commercial-key \
  -v /mnt/user/media:/media \
  lucidfabrics/bitbonsai-worker:latest
```

---

## How It Works

### 1. Scan Your Library
Point BitBonsai at your media directories. It intelligently scans for:
- Movies, TV shows, anime, home videos
- Codec distribution (H.264, HEVC, AV1, etc.)
- File sizes and bitrates
- Encoding inefficiencies

### 2. Create Policies
Define encoding rules once:
```
Policy: "Optimize TV Shows"
- Source: /media/TV
- Target Codec: HEVC (H.265)
- Quality: CRF 23
- Audio: Copy all tracks
- Subtitles: Copy all tracks
- Hardware: Use NVENC if available
- Scheduling: Off-peak hours (2 AM - 6 AM)
```

### 3. Watch It Work
BitBonsai automatically:
- Queues files for encoding
- Distributes work across available nodes (commercial tier)
- Monitors progress with live updates
- Verifies encoded files
- Replaces originals (or saves alongside - your choice)
- Updates media server libraries (Plex/Jellyfin/Emby)

### 4. Enjoy the Results
Typical results:
- **40-60% storage savings** (H.264 → HEVC)
- **60-70% storage savings** (H.264 → AV1)
- **Same or better visual quality**
- **Faster streaming** (modern codecs are more efficient)

---

## Why BitBonsai vs Alternatives?

| Feature | BitBonsai | Unmanic | Tdarr | HandBrake | FileFlows |
|---------|-----------|---------|-------|-----------|-----------|
| **Zero-Plugin Architecture** | ✅ | ❌ (47+ plugins) | ❌ (100+ plugins) | ✅ | ❌ |
| **Beautiful UI** | ✅ | ❌ | ❌ | ⚠️ | ⚠️ |
| **Multi-Node (Out of Box)** | ✅ | ❌ | ✅ | ❌ | ✅ |
| **Hardware Encoding** | ✅ | ⚠️ (plugin) | ✅ | ✅ | ✅ |
| **Smart Policies** | ✅ | ⚠️ (complex) | ⚠️ (complex) | ❌ | ✅ |
| **Real-Time Analytics** | ✅ | ❌ | ⚠️ | ❌ | ❌ |
| **Free Tier** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Commercial Pricing** | $29-299/yr | Free only | $10/mo | N/A | $20/mo |
| **Setup Time** | 5 minutes | 2+ hours | 3+ hours | N/A | 1 hour |

---

## Documentation

### Getting Started
- [Installation Guide](./docs/installation.md)
- [First-Time Setup](./docs/setup.md)
- [Creating Policies](./docs/policies.md)
- [Multi-Node Configuration](./docs/multi-node.md)

### Advanced Topics
- [Hardware Encoding Setup](./docs/hardware-encoding.md)
- [PostgreSQL Configuration](./docs/postgresql.md)
- [Redis/BullMQ Setup](./docs/redis.md)
- [API Reference](./docs/api.md)

### Integration
- [Unraid Template](./unraid/README.md)
- [Plex Integration](./docs/plex.md)
- [Jellyfin Integration](./docs/jellyfin.md)
- [Emby Integration](./docs/emby.md)

### Development
- [Contributing Guidelines](./CONTRIBUTING.md)
- [Code Conventions](./code-conventions/README.md)
- [Angular Guidelines](./code-conventions/angular-guidelines.md)
- [NestJS Guidelines](./code-conventions/nestjs-guidelines.md)
- [Building from Source](./docs/building.md)

---

## Development

### Prerequisites
- Node.js 20+ LTS
- Docker 24+
- Angular CLI 19+
- NestJS CLI 10+

### Local Development

```bash
# Clone repository
git clone https://github.com/lucidfabrics/bitbonsai.git
cd bitbonsai

# Install dependencies
npm install

# Run frontend + backend (with HMR)
npx nx dev

# Frontend: http://localhost:4200
# Backend: http://localhost:3000/api/v1
```

### Docker Development

```bash
# Run full stack with hot reload
npx nx docker:dev

# Stop development environment
npx nx docker:dev:down
```

### Building

```bash
# Build frontend
npm run build

# Build backend
npm run build:api

# Build Docker image
npm run docker:build

# Build and push to Docker Hub
npm run docker:build-push
```

### Testing

```bash
# Run all tests
npm test

# Run frontend tests
npx nx test frontend

# Run backend tests
npx nx test backend

# E2E tests
npm run e2e
```

---

## Contributing

We welcome contributions! Before submitting:

1. **Read our [Code Conventions](./code-conventions/README.md)**
2. **Follow [Angular Guidelines](./code-conventions/angular-guidelines.md)** for frontend
3. **Follow [NestJS Guidelines](./code-conventions/nestjs-guidelines.md)** for backend
4. **Write tests** per [Testing Guidelines](./code-conventions/testing-guidelines.md)
5. **Use proper [Git Workflow](./code-conventions/git-commit-instructions.md)**

### Development Philosophy

BitBonsai follows these principles:
- **Simplicity over complexity** - Zero plugins, sensible defaults
- **Beauty over utility** - UX matters as much as functionality
- **Performance over features** - Fast, responsive, scalable
- **Privacy over convenience** - Self-hosted, no telemetry, no tracking

---

## Support

### Community Support (Free Tier)
- [GitHub Discussions](https://github.com/lucidfabrics/bitbonsai/discussions)
- [GitHub Issues](https://github.com/lucidfabrics/bitbonsai/issues)
- [Discord Community](https://discord.gg/lucidfabrics)

### Commercial Support
- **Starter**: Email support (48h response)
- **Professional**: Email support (24h response)
- **Enterprise**: Slack/Phone support (4h response) + SLA

**Contact**: [support@lucidfabrics.com](mailto:support@lucidfabrics.com)

---

## License

BitBonsai uses a **dual-license model**:

### MIT License (Free Tier)
The core BitBonsai software is licensed under the [MIT License](./LICENSE-MIT.md) for non-commercial, single-node use.

**You can freely:**
- Use BitBonsai for personal media libraries
- Modify the source code
- Distribute copies
- Use for non-commercial projects

**Limitations:**
- Single node only
- SQLite database
- Up to 5 concurrent jobs

### Commercial License (Paid Tiers)
Commercial features (multi-node, PostgreSQL, Redis/BullMQ, hardware encoding, etc.) require a paid license.

**[View Commercial License Terms →](./LICENSE-COMMERCIAL.md)**

**[Purchase Commercial License →](https://buy.lucidfabrics.com/bitbonsai)**

---

## Support the Project

If BitBonsai saves you storage space and keeps your library organized, consider supporting development:

### One-Time Donations
[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/lucidfabrics)

### Monthly Support
[![Become a Patron](https://img.shields.io/badge/Patreon-Support%20Development-FF424D?style=for-the-badge&logo=patreon)](https://patreon.com/lucidfabrics)

Your support enables:
- Faster feature development
- Better documentation
- Improved hardware encoding support
- More codec options (AV1, VP9, etc.)
- Enhanced multi-node capabilities

---

## Roadmap

### v0.2 (Q2 2025)
- [ ] AV1 encoding support
- [ ] Advanced scheduling (off-peak hours)
- [ ] Webhook integrations
- [ ] Mobile app (iOS/Android)

### v0.3 (Q3 2025)
- [ ] Machine learning quality prediction
- [ ] Auto-tagging and metadata extraction
- [ ] Multi-user support with permissions
- [ ] Cloud storage integration (S3, B2, etc.)

### v1.0 (Q4 2025)
- [ ] Enterprise SSO/LDAP
- [ ] High-availability clustering
- [ ] White-label UI options
- [ ] Professional SLA support

[View Full Roadmap →](./ROADMAP.md)

---

## Credits

**Created by [Lucid Fabrics](https://lucidfabrics.com)**

BitBonsai is built with:
- [Angular 19](https://angular.dev) - Modern web framework
- [NestJS 10](https://nestjs.com) - Progressive Node.js framework
- [NgRx](https://ngrx.io) - Reactive state management
- [PostgreSQL](https://postgresql.org) - Robust database
- [Redis](https://redis.io) - High-performance caching
- [BullMQ](https://bullmq.io) - Distributed job queue
- [FFmpeg](https://ffmpeg.org) - Media encoding powerhouse

Special thanks to the open-source community for making this possible.

---

## FAQ

**Q: Why the name "BitBonsai"?**
A: Bonsai trees are meticulously pruned and shaped over time. Your media library deserves the same care - removing waste (inefficient codecs) while preserving beauty (video quality).

**Q: How is this different from Unmanic?**
A: Unmanic requires 47+ plugins and complex configuration. BitBonsai works out of the box with zero plugins and a beautiful UI.

**Q: Can I try commercial features before buying?**
A: Yes! Commercial licenses include a 30-day money-back guarantee. No questions asked.

**Q: Do I need to stop Plex/Jellyfin while encoding?**
A: No! BitBonsai can encode files while your media server continues streaming.

**Q: What about audio and subtitles?**
A: By default, all audio tracks and subtitles are preserved. You can customize this per policy.

**Q: Does this work on Windows/Mac/Linux?**
A: BitBonsai runs anywhere Docker runs. We officially support Linux (Unraid, Ubuntu, Debian) and macOS. Windows support is community-maintained.

**Q: Can I encode from one location to another?**
A: Yes! You can configure source and destination paths per policy.

**Q: What happens if encoding fails?**
A: BitBonsai automatically retries failed jobs 3 times. Original files are never deleted until successful verification.

---

<div align="center">

**Made with ❤️ by [Lucid Fabrics](https://lucidfabrics.com)**

[Website](https://bitbonsai.dev) • [Documentation](./docs) • [GitHub](https://github.com/lucidfabrics/bitbonsai) • [Discord](https://discord.gg/lucidfabrics)

⭐ **Star us on GitHub if BitBonsai helps you!** ⭐

</div>
