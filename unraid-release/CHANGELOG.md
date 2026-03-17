# BitBonsai Changelog

## [Unreleased]

### Added (Latest Features)
- ⚡ **Cache Pool Support**: SSD temp file storage for 10-100x faster encoding
- 🔄 **Auto-Healing**: Automatic job recovery with smart temp file detection
- ♻️ **Resume Capability**: Jobs resume from checkpoint after crashes/reboots
- 📊 **Enhanced Progress Tracking**: Real-time ETA, FPS, and size statistics
- 🎯 **Smart Retry Logic**: Exponential backoff for failed jobs
- 🔍 **Audit Trail**: Complete job history with healing decisions
- 🏥 **Health Monitoring**: Stuck job detection and recovery

### Changed
- Improved temp file persistence across container restarts
- Enhanced manual retry to preserve resume state
- Better logging for debugging and monitoring
- Optimized database queries with composite indexes

### Fixed
- Temp files now correctly preserved on manual retry
- Auto-healing properly detects and reports missing temp files
- Progress tracking accuracy improved for resumed jobs

## [Previous Releases]

See full changelog at: https://github.com/lucid-fabrics/bitbonsai/releases
