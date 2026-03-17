# BitBonsai Integration Test Suite

Comprehensive integration tests for the BitBonsai encoding system with 10 levels of complexity.

## Overview

This test suite validates the entire encoding pipeline from job creation to completion, including:

- Video encoding with FFmpeg (H.264, HEVC, VP9, AV1, MPEG-2)
- Job lifecycle management (DETECTED → QUEUED → ENCODING → COMPLETED)
- Worker pool orchestration
- Auto-heal/recovery scenarios
- Edge cases (corrupted files, missing files, permission errors)
- **Video quality verification (CRITICAL)**
- Concurrent encoding
- Series/batch processing

## Test Levels

### Level 1: Basic Single Job Flow
**Complexity:** Low
**Files:** 1 video, 10-50MB
**Duration:** ~30 seconds

Tests basic single job encoding:
- H.264 → HEVC conversion
- Job lifecycle tracking
- File replacement verification
- Size reduction validation

### Level 2: Multiple Codecs
**Complexity:** Low-Medium
**Files:** 3-5 videos, 20-50MB each
**Duration:** ~2-3 minutes

Tests encoding from various source codecs:
- H.264, VP9, MPEG-2 → HEVC
- Container formats (MP4, MKV, AVI, TS)
- Resolution preservation (480p, 720p, 1080p)

### Level 3: Concurrent Encoding
**Complexity:** Medium
**Files:** 3-5 videos, 20-40MB each
**Duration:** ~2-3 minutes

Tests concurrent job processing:
- Multiple workers (4 concurrent)
- Worker pool management
- No race conditions
- All jobs complete successfully

### Level 4: Edge Cases
**Complexity:** Medium-High
**Files:** 5-7 videos, 10-50MB
**Duration:** ~3-4 minutes

Tests handling of problematic files:
- Corrupted videos (missing header, partial download, truncated)
- Missing source files
- File permission errors
- Retry logic with exponential backoff

### Level 5: Auto-Heal (Already exists)
**Complexity:** Medium
**Files:** Minimal
**Duration:** ~1-2 minutes

Tests auto-recovery after backend crashes:
- Orphaned jobs reset to QUEUED
- Jobs resume after restart
- See `auto-heal.integration.spec.ts`

### Level 6: Worker Pool Management
**Complexity:** Medium
**Duration:** ~2-3 minutes

Tests worker orchestration:
- Dynamic worker pool resizing
- Worker crashes/failures
- Graceful shutdown
- Node offline scenarios

### Level 7: TV Series Processing
**Complexity:** Medium-High
**Files:** 5-10 episodes, 50-100MB each
**Duration:** ~5-8 minutes

Tests batch processing of TV series:
- Multiple episodes processed sequentially/concurrently
- Season-wide encoding
- Episode naming conventions

### Level 8: Video Quality Verification (CRITICAL)
**Complexity:** High
**Files:** 5-7 videos, 50-200MB
**Duration:** ~5-7 minutes

**THE MOST CRITICAL TEST SUITE** - Validates encoded file quality:
- ✅ Output file exists and is playable
- ✅ Resolution matches target
- ✅ Codec matches target (HEVC)
- ✅ Bitrate within acceptable range
- ✅ Audio tracks preserved
- ✅ Subtitles preserved (if applicable)
- ✅ File size reduction achieved
- ✅ No corruption (FFprobe validation)
- ✅ Visual quality acceptable (PSNR/SSIM)

### Level 9: Stress Testing
**Complexity:** High
**Files:** 10-20 videos, 100-300MB
**Duration:** ~10-15 minutes

Tests system under high load:
- Many concurrent jobs (10-20)
- Large file sizes (100-300MB)
- Memory/CPU usage monitoring
- System stability

### Level 10: Full End-to-End Suite
**Complexity:** Very High
**Files:** 20-30 videos, mix of sizes (up to 500MB)
**Duration:** ~15-20 minutes

Complete integration test covering all scenarios:
- Movies, series, anime mix
- All codecs and resolutions
- Concurrent processing
- Edge cases
- Auto-heal scenarios
- Quality verification

## Running Tests

### Run All Levels (Full Suite)
```bash
npm run test:encoding:integration
```

### Run Specific Level
```bash
# Level 1 only
npm run test:encoding:level1

# Level 8 (Quality verification - CRITICAL)
npm run test:encoding:level8
```

### Run All Levels Sequentially
```bash
npm run test:encoding:all-levels
```

## Test Infrastructure

### Video Generator (`fixtures/video-generator.ts`)
Generates realistic test videos using FFmpeg:
- Various codecs (H.264, HEVC, VP9, AV1, MPEG-2)
- Various resolutions (480p, 720p, 1080p, 4K)
- Various containers (MP4, MKV, AVI, TS)
- Audio tracks (AAC, AC3, DTS, multiple)
- Subtitles (SRT, ASS embedded)
- Corrupted videos (for edge case testing)

### Test Helpers (`fixtures/test-helpers.ts`)
Utilities for test setup:
- In-memory SQLite database
- Test module creation
- Database seeding
- Job creation helpers
- Wait for job completion utilities

## Database Configuration

Tests use **in-memory SQLite** for:
- Fast execution (no disk I/O)
- Test isolation (fresh database per test suite)
- No cleanup required (database destroyed on exit)

Database connection string:
```
file::memory:?cache=shared
```

## Quality Metrics

### Video Quality Verification
Tests use FFprobe to extract comprehensive metrics:

```typescript
{
  isPlayable: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string;      // Expected: 'hevc'
  audioCodec: string;
  resolution: string;      // Expected: preserved from source
  duration: number;        // Expected: preserved (±1%)
  bitrate: number;
  frameCount: number;
  audioTracks: number;
  subtitleTracks: number;
}
```

### PSNR (Peak Signal-to-Noise Ratio)
Measures visual quality:
- **>30 dB**: Good quality
- **>40 dB**: Excellent quality (near lossless)

## Test Output

### Success Example
```
✅ Level 8: Video Quality Verification
  ✅ CRITICAL: encoded file must exist and be playable
     - Generated: Quality.Playable.Test.720p.mkv (40MB)
     - Encoded: HEVC, 1280x720, 15s duration
     - Quality: Playable, PSNR 38.5dB
     - Size reduction: 32.4% (13MB saved)

  ✅ CRITICAL: codec must match target (HEVC)
     - Source: H.264
     - Output: HEVC ✓

  ✅ CRITICAL: resolution must be preserved
     - Source: 1920x1080
     - Output: 1920x1080 ✓
```

### Failure Example
```
❌ Level 8: Video Quality Verification
  ❌ CRITICAL: encoded file must exist and be playable
     - Expected output to be playable
     - FFprobe error: Invalid data found when processing input
     - File may be corrupted or encoding failed
```

## Performance Targets

- **Level 1-3**: Complete in <5 minutes total
- **Level 4-7**: Complete in <15 minutes total
- **Level 8**: Complete in <10 minutes (CRITICAL - must pass)
- **Level 9-10**: Complete in <30 minutes total
- **Full suite**: Complete in <60 minutes

## Cleanup

Tests automatically clean up:
- Generated video files (deleted after test suite)
- Database entries (in-memory, destroyed on exit)
- Temporary encoding files (removed by encoding service)

Manual cleanup (if needed):
```bash
rm -rf apps/backend/src/encoding/__tests__/fixtures/generated
```

## Debugging

### Enable FFmpeg Logs
Set environment variable:
```bash
DEBUG=ffmpeg npm run test:encoding:level8
```

### View Test Database
Tests use in-memory database, but you can switch to file-based for debugging:

```typescript
// In test-helpers.ts
export function getInMemoryDatabaseUrl(): string {
  return 'file:./test.db'; // Persistent file
}
```

### Run Single Test
```bash
npm run test:encoding:integration -- --testNamePattern="CRITICAL: encoded file must exist"
```

## Contributing

When adding new tests:

1. Follow the level-based naming convention
2. Use the video generator utilities
3. Clean up generated files
4. Add test to appropriate level (1-10)
5. Update this README

## Critical Tests (Must Pass)

These tests are marked **CRITICAL** and must always pass:

- ✅ Level 8: All video quality verification tests
- ✅ Level 1: Basic job lifecycle
- ✅ Level 5: Auto-heal orphaned jobs
- ✅ Level 3: Concurrent encoding (no race conditions)

If any CRITICAL test fails, the deployment should be blocked.

## Known Limitations

1. **PSNR Calculation**: Skipped if FFmpeg doesn't support it (fallback to basic validation)
2. **File Permissions**: Unix-only tests (skipped on Windows)
3. **Large Files**: Level 10 may timeout on slow systems (increase Jest timeout)
4. **Concurrent Jobs**: Limited by system CPU/memory (adjust maxWorkers)

## License

Part of BitBonsai - See LICENSE in repository root.
