# Changelog

All notable changes to BitBonsai will be documented in this file.

## [1.0.0-beta] - 2024-12-21

### Added
- **Core Encoding Engine**
  - Smart codec detection (H.264, H.265, AV1, VP9, MPEG-2, MPEG-4)
  - H.264 to H.265/HEVC conversion with 40-60% space savings
  - Configurable quality presets (CRF-based encoding)
  - Audio and subtitle track preservation

- **TRUE RESUME Technology**
  - Resume interrupted jobs from exact timestamp
  - Progress tracking to the frame level
  - Zero progress loss after crashes or restarts

- **Auto-Heal System**
  - 4-layer crash recovery defense
  - Automatic orphaned job detection on startup
  - Volume mount race condition handling
  - Self-healing without manual intervention

- **Hardware Acceleration**
  - NVIDIA NVENC support
  - Intel QuickSync (QSV) support
  - AMD AMF support
  - Automatic hardware detection

- **Multi-Node Distribution**
  - MAIN/LINKED node architecture
  - mDNS auto-discovery for easy setup
  - Manual pairing for VLANs/VPNs
  - Automatic SSH key exchange
  - NFS shared storage detection
  - Rsync file transfer fallback

- **Library Management**
  - Multiple library support
  - Smart encoding policies
  - Library-based queue filtering
  - Automatic file scanning

- **User Interface**
  - Real-time progress with FPS and ETA
  - Per-node statistics dashboard
  - Analytics and insights
  - Priority queue management
  - Job retry and management

- **Integrations**
  - Jellyfin library refresh after encoding

- **Platform Support**
  - Docker deployment
  - Unraid Community Applications template
  - Network host mode for node discovery

### Known Issues
- AV1 encoding not yet available
- Plex/Emby integration incomplete
- Some UI polish still in progress

---

## Future Releases

### Planned for Next Release
- AV1 encoding support
- Plex integration
- Emby integration
- Webhook notifications (Discord, Slack)
- Scheduled encoding (off-peak hours)

### Roadmap
- Mobile app
- Cloud storage support (S3, B2)
- Advanced analytics
- Machine learning quality optimization

---

For more details, see the [GitHub repository](https://github.com/lucid-fabrics/bitbonsai).
