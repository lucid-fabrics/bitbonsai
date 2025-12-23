# BitBonsai

### Automated Video Transcoding for Media Servers

<div align="center">

![Beta](https://img.shields.io/badge/Status-Public%20Beta-orange?style=for-the-badge)
[![Docker](https://img.shields.io/badge/Docker-Available-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://hub.docker.com/r/lucidfabrics/bitbonsai)
[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/lucidfabrics)
[![Patreon](https://img.shields.io/badge/Support-Patreon-F96854?style=for-the-badge&logo=patreon&logoColor=white)](https://patreon.com/lucidfabrics)

**Save 40-70% storage on your media library. Zero configuration. Set it and forget it.**

[Get Started](#-quick-start) • [Features](#-features) • [Pricing](#-pricing) • [Support](#-support)

</div>

---

## The Problem

Your media library is bloated. A single 4K movie can be **50GB+** in H.264. Storage fills up, backups take forever, and streaming stutters on slower connections.

## The Solution

BitBonsai automatically converts your library to modern codecs (HEVC/AV1), reducing storage by **40-70%** with no visible quality loss. It runs in the background, self-heals from failures, and works while you sleep.

---

## Features

| Feature | Description |
|---------|-------------|
| **Zero Config** | Smart defaults that work out of the box. No tuning required. |
| **TRUE Resume** | Crashed at 80%? Resume from exactly where you left off. Never restart from 0%. |
| **Self-Healing** | Automatic crash recovery. Jobs resurrect themselves without intervention. |
| **Multi-Node** | Distribute encoding across multiple machines for faster processing. |
| **Hardware Accel** | NVIDIA NVENC, Intel QuickSync, AMD AMF support. |
| **Integrations** | Works with Plex, Jellyfin, Emby, Radarr, Sonarr. |

### Before & After

| Library | Before | After | Savings |
|---------|--------|-------|---------|
| Movies (500 files) | 12.4 TB | 5.1 TB | **59%** |
| TV Shows (2000 eps) | 8.2 TB | 3.4 TB | **58%** |
| 4K Collection | 6.8 TB | 2.1 TB | **69%** |

*Real results from beta users. Your mileage may vary based on source quality.*

---

## Quick Start

### Docker (Recommended)

```bash
docker run -d \
  --name bitbonsai \
  -p 4210:4210 \
  -p 3100:3100 \
  -v /path/to/media:/media \
  -v /path/to/config:/config \
  lucidfabrics/bitbonsai:latest
```

Then open **http://localhost:4210** and follow the setup wizard.

### Unraid

Available in Community Applications. Search for **BitBonsai**.

### Docker Compose

```yaml
version: '3.8'
services:
  bitbonsai:
    image: lucidfabrics/bitbonsai:latest
    container_name: bitbonsai
    ports:
      - "4210:4210"
      - "3100:3100"
    volumes:
      - /path/to/media:/media
      - /path/to/config:/config
    restart: unless-stopped
```

---

## Pricing

BitBonsai is **free to use** with generous limits. Support the project to unlock more.

| Tier | Price | Nodes | Concurrent Jobs |
|------|-------|-------|-----------------|
| **Free** | $0 | 1 | 2 |
| **Supporter** | $3/mo | 2 | 3 |
| **Plus** | $5/mo | 3 | 5 |
| **Pro** | $10/mo | 5 | 10 |
| **Ultimate** | $20/mo | 10 | 20 |

<div align="center">

[![Support on Ko-fi](https://img.shields.io/badge/Support_on-Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/lucidfabrics)
[![Support on Patreon](https://img.shields.io/badge/Support_on-Patreon-F96854?style=for-the-badge&logo=patreon&logoColor=white)](https://patreon.com/lucidfabrics)

</div>

**Commercial licenses** available for businesses. [Contact us](mailto:enterprise@bitbonsai.io) for pricing.

---

## Screenshots

<div align="center">

| Queue | Analytics | Multi-Node |
|-------|-----------|------------|
| ![Queue](https://via.placeholder.com/300x200?text=Queue) | ![Analytics](https://via.placeholder.com/300x200?text=Analytics) | ![Nodes](https://via.placeholder.com/300x200?text=Nodes) |

</div>

---

## Requirements

- **Docker** or **Unraid**
- **2GB RAM** minimum (4GB recommended)
- **CPU**: Any modern x86_64 processor
- **GPU** (optional): NVIDIA GTX 1050+ / Intel 6th gen+ / AMD RX 400+

---

## Support

- **Issues**: [GitHub Issues](https://github.com/lucid-fabrics/bitbonsai/issues)
- **Discord**: Coming soon
- **Email**: support@bitbonsai.io

---

## License

BitBonsai is proprietary software. Free tier available for personal use.

---

<div align="center">

**Made with mass amounts of mass produced coffee**

[![Ko-fi](https://img.shields.io/badge/Buy_me_a_coffee-Ko--fi-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white)](https://ko-fi.com/lucidfabrics)

</div>
