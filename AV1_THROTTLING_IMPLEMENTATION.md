# AV1 Resource Throttling Implementation Plan

## Problem
AV1 → HEVC transcoding is extremely CPU-intensive (10-20x slower than H.264 → HEVC) and causes:
- Jobs to be killed after 36 retry attempts
- System instability
- Poor user experience (no warning about long encoding times)

## Solution
Implement intelligent resource management with **prominent user warnings** and automatic CPU throttling.

## Implementation Steps

### 1. Database Schema ✅ DONE
- Added `warning` field for user-facing messages
- Added `resourceThrottled`, `resourceThrottleReason`, `ffmpegThreads`
- Added `startedFromSeconds`, `healingPointSeconds` for resume support

### 2. Queue Service - AV1 Detection & Warning
**File:** `apps/backend/src/queue/queue.service.ts`

**Changes:**
```typescript
// After detecting sourceCodec (search for "sourceCodec = ")
if (sourceCodec.toLowerCase() === 'av1') {
  const durationHours = videoDuration / 3600;
  const estimatedHours = Math.round(durationHours * 150); // AV1 is ~150x slower

  warning = `⚠️ WARNING: AV1 → HEVC TRANSCODING\n\n` +
    `This is an extremely resource-intensive task:\n` +
    `• Expected encoding time: ${estimatedHours}+ hours (for ${Math.round(durationHours)}h video)\n` +
    `• CPU usage will be limited to 8 threads to prevent system instability\n` +
    `• Output file may be LARGER than source (AV1 is more efficient than HEVC)\n\n` +
    `⚠️ RECOMMENDATION: Skip this file or reconsider target codec`;

  resourceThrottled = true;
  resourceThrottleReason = 'AV1 source codec requires reduced CPU usage';
  ffmpegThreads = 8; // Limit to 8 threads
}
```

### 3. FFmpeg Service - Thread Limiting
**File:** `apps/backend/src/encoding/ffmpeg.service.ts`

**Changes:**
```typescript
// In buildFFmpegCommand() or encode() method
// Add thread parameter from job.ffmpegThreads
if (job.ffmpegThreads) {
  command.push('-threads', job.ffmpegThreads.toString());
  this.logger.warn(`[${jobId}] Using ${job.ffmpegThreads} threads (resource throttled: ${job.resourceThrottleReason})`);
}
```

### 4. Encoding Processor - Logging
**File:** `apps/backend/src/encoding/encoding-processor.service.ts`

**Changes:**
```typescript
// When starting encoding, log throttling status
if (job.resourceThrottled) {
  this.logger.warn(`[${job.id}] RESOURCE THROTTLED JOB STARTING`);
  this.logger.warn(`[${job.id}] Reason: ${job.resourceThrottleReason}`);
  this.logger.warn(`[${job.id}] FFmpeg threads: ${job.ffmpegThreads}`);
  this.logger.warn(`[${job.id}] Warning: ${job.warning}`);
}
```

### 5. Frontend - Warning Display
**File:** `apps/frontend/src/app/pages/queue/queue.component.html`

**Changes:**
- Add warning badge/icon next to jobs with `job.warning`
- Show full warning text in tooltip or expanded view
- Use Material alert component with `warn` color

### 6. Testing
- Test with Spectre (2015) AV1 file
- Verify 8-thread limit is applied
- Verify warning appears in UI
- Monitor encoding speed and system stability

## Key Files to Modify
1. ✅ `prisma/schema.prisma` - Database schema
2. ✅ `prisma/migrations/.../migration.sql` - Migration file
3. `apps/backend/src/queue/queue.service.ts` - AV1 detection
4. `apps/backend/src/encoding/ffmpeg.service.ts` - Thread limiting
5. `apps/backend/src/encoding/encoding-processor.service.ts` - Logging
6. `apps/frontend/src/app/pages/queue/*` - Warning UI

## Expected Behavior After Implementation
1. **When AV1 file is added to queue:**
   - Warning message is set immediately
   - `resourceThrottled = true`
   - `ffmpegThreads = 8`

2. **When encoding starts:**
   - FFmpeg uses only 8 threads
   - Logs show throttling status
   - Frontend displays prominent warning

3. **User sees:**
   - Clear warning about long encoding time
   - Recommendation to skip file
   - Estimated completion time
   - Reason for throttling

## Success Criteria
- ✅ Spectre (2015) job doesn't get killed
- ✅ Encoding progresses (even if slow)
- ✅ User sees warning before/during encoding
- ✅ System remains stable
- ✅ CPU usage is controlled
