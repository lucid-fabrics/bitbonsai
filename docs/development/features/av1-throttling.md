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
# AV1 Resource Throttling Implementation Summary

## Overview
Implemented intelligent resource throttling for AV1 → HEVC transcoding jobs to prevent system instability and provide clear user warnings about extremely slow encoding times.

## Files Modified

### 1. `/apps/backend/src/queue/queue.service.ts`
**Changes:**
- Added AV1 detection logic in `handleFileDetected()` method (lines 202-226)
- Generates prominent warning message with estimated encoding time
- Sets `resourceThrottled`, `resourceThrottleReason`, and `ffmpegThreads` fields
- Updated `create()` method to accept new throttling fields (lines 109-113)

**Key Logic:**
```typescript
if (videoInfo.codec.toLowerCase() === 'av1') {
  const durationHours = videoInfo.duration / 3600;
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

### 2. `/apps/backend/src/queue/dto/create-job.dto.ts`
**Changes:**
- Added 4 new optional fields to the DTO:
  - `warning?: string` - User-facing warning message
  - `resourceThrottled?: boolean` - Whether throttling is enabled
  - `resourceThrottleReason?: string` - Reason for throttling
  - `ffmpegThreads?: number` - Number of threads to use

**Validation:**
- Added proper decorators (`@IsOptional`, `@IsString`, `@IsBoolean`, `@IsInt`)
- Added Swagger API documentation with examples

### 3. `/apps/backend/src/encoding/ffmpeg.service.ts`
**Changes:**
- Modified `buildFfmpegCommand()` to check for `job.ffmpegThreads` field (lines 363-370)
- Adds `-threads` flag to FFmpeg command when thread limit is specified
- Logs warning message with thread count and throttle reason

**Key Logic:**
```typescript
// AV1 THROTTLING: Apply thread limit if specified on job
const jobWithThreads = job as any;
if (jobWithThreads.ffmpegThreads) {
  args.push('-threads', jobWithThreads.ffmpegThreads.toString());
  this.logger.warn(
    `[${job.id}] Using ${jobWithThreads.ffmpegThreads} threads (resource throttled: ${jobWithThreads.resourceThrottleReason || 'unknown reason'})`
  );
}
```

### 4. `/apps/backend/src/encoding/encoding-processor.service.ts`
**Changes:**
- Added throttling status logging when processing throttled jobs (lines 1056-1065)
- Logs all throttling details at WARN level for visibility

**Key Logic:**
```typescript
// AV1 THROTTLING: Log throttling status if job is resource-throttled
const jobWithThrottle = job as any;
if (jobWithThrottle.resourceThrottled) {
  this.logger.warn(`[${job.id}] RESOURCE THROTTLED JOB STARTING`);
  this.logger.warn(`[${job.id}] Reason: ${jobWithThrottle.resourceThrottleReason}`);
  this.logger.warn(`[${job.id}] FFmpeg threads: ${jobWithThrottle.ffmpegThreads}`);
  if (jobWithThrottle.warning) {
    this.logger.warn(`[${job.id}] Warning: ${jobWithThrottle.warning}`);
  }
}
```

## Database Schema
The following fields were already added via migration `20251102002832_add_av1_throttling_fields`:
- `warning TEXT` - User-facing warning message
- `resourceThrottled BOOLEAN NOT NULL DEFAULT 0` - Throttling flag
- `resourceThrottleReason TEXT` - Why throttling was applied
- `ffmpegThreads INTEGER` - Number of threads for FFmpeg

## How It Works

### 1. Job Creation
When a file is detected by the file watcher:
1. `MediaAnalysisService.probeVideoFile()` is called to get codec and duration
2. If codec is `av1` (case-insensitive):
   - Calculate estimated encoding time (duration × 150)
   - Generate warning message with estimated hours
   - Set `resourceThrottled = true`
   - Set `ffmpegThreads = 8`
3. Create job with these fields populated

### 2. Job Execution
When the encoding worker picks up the job:
1. `EncodingProcessorService.processNextJob()` logs throttling status
2. `FfmpegService.buildFfmpegCommand()` adds `-threads 8` to FFmpeg args
3. FFmpeg runs with limited threads (prevents system overload)
4. All throttling actions are logged at WARN level

### 3. User Experience
- **Frontend (TODO):** Display prominent warning badge/icon on job in queue
- **Backend Logs:** Clear warning messages about throttling
- **Estimated Time:** User sees estimated completion time upfront
- **Thread Limit:** CPU usage is automatically limited to 8 threads

## Testing

### Test File
Use the Spectre (2015) AV1 file for testing:
```bash
/unraid-media/Movies/Spectre (2015)/Spectre (2015) WEBDL-2160p.mkv
```

### Verification Steps
1. **Check job creation:**
   ```bash
   # Monitor backend logs for AV1 detection
   docker logs -f bitbonsai-backend-1 | grep "AV1"
   ```

2. **Verify warning message:**
   - Check job record in database for `warning` field
   - Or use API: `GET /api/jobs/{jobId}` and check response

3. **Verify thread limiting:**
   ```bash
   # When job starts encoding, check logs for:
   # "[jobId] Using 8 threads (resource throttled: AV1 source codec requires reduced CPU usage)"
   docker logs -f bitbonsai-backend-1 | grep "threads"
   ```

4. **Monitor CPU usage:**
   ```bash
   # Should stay within reasonable limits (not maxing out all cores)
   htop
   ```

5. **Check FFmpeg command:**
   ```bash
   # Look for "-threads 8" in the FFmpeg command
   docker logs bitbonsai-backend-1 | grep "ffmpeg command"
   ```

## Expected Behavior

### For AV1 Files:
- ✅ Job created with warning message
- ✅ `resourceThrottled = true`
- ✅ `ffmpegThreads = 8`
- ✅ FFmpeg runs with `-threads 8` flag
- ✅ Logs show throttling status at WARN level
- ✅ System remains stable (CPU doesn't max out)

### For Non-AV1 Files:
- ✅ Job created without throttling
- ✅ `resourceThrottled = false`
- ✅ `ffmpegThreads = null`
- ✅ FFmpeg runs without thread limit
- ✅ No throttling logs

## Next Steps (Frontend)

### Frontend Implementation Needed:
1. Display warning icon/badge on jobs with `job.warning` field
2. Show warning message in tooltip or expanded job details
3. Use Material `<mat-icon>warning</mat-icon>` with amber color
4. Add prominent alert box when viewing AV1 job details

### Example Frontend Code:
```typescript
// In queue.component.ts
isThrottled(job: Job): boolean {
  return job.resourceThrottled === true;
}

getWarningMessage(job: Job): string | null {
  return job.warning || null;
}
```

```html
<!-- In queue.component.html -->
<mat-icon 
  *ngIf="isThrottled(job)" 
  color="warn" 
  [matTooltip]="getWarningMessage(job)">
  warning
</mat-icon>
```

## Benefits

1. **System Stability:** CPU usage limited to 8 threads prevents system overload
2. **User Awareness:** Clear warnings about extremely long encoding times
3. **Informed Decisions:** Users can skip AV1 files or reconsider target codec
4. **Better Logging:** All throttling actions logged for troubleshooting
5. **Automatic Detection:** No manual configuration needed

## Limitations

1. **Estimation Accuracy:** 150x multiplier is approximate (actual may vary)
2. **No Dynamic Adjustment:** Thread limit is fixed at 8 (could be made configurable)
3. **Frontend Not Implemented:** Warning message only in backend logs/API currently
4. **AV1 Only:** Doesn't throttle other slow codecs (VP9, etc.)

## Performance Impact

- **Minimal:** Detection happens during file probing (already required)
- **No Overhead:** Thread limiting is native FFmpeg feature
- **Logging:** Minimal impact from additional log statements
# AV1 Throttling Test Plan

## Test Environment
- **Server:** http://192.168.1.100:4210 (Frontend) / http://192.168.1.100:3100 (API)
- **Test File:** `/unraid-media/Movies/Spectre (2015)/Spectre (2015) WEBDL-2160p.mkv`
- **Expected Codec:** AV1
- **Backend Container:** `bitbonsai-backend-1`

## Prerequisites
1. Backend must be running with latest code changes
2. Database migration `20251102002832_add_av1_throttling_fields` must be applied
3. Test file must exist at the specified path

## Test Cases

### Test 1: AV1 File Detection
**Objective:** Verify AV1 codec is detected correctly

**Steps:**
1. Add test file to library watch path
2. Monitor backend logs:
   ```bash
   docker logs -f bitbonsai-backend-1 | grep -i "av1"
   ```

**Expected Results:**
- ✅ Log shows: `AV1 source detected for Spectre (2015) WEBDL-2160p.mkv - will throttle to 8 threads`
- ✅ Job is created in DETECTED stage
- ✅ Job has `sourceCodec = av1`

### Test 2: Warning Message Generation
**Objective:** Verify warning message is populated

**Steps:**
1. Wait for job to be created (from Test 1)
2. Query job via API:
   ```bash
   curl http://192.168.1.100:3100/api/jobs | jq '.[] | select(.sourceCodec == "av1")'
   ```

**Expected Results:**
- ✅ Job has `warning` field populated
- ✅ Warning contains "⚠️ WARNING: AV1 → HEVC TRANSCODING"
- ✅ Warning contains estimated hours (e.g., "Expected encoding time: XXX+ hours")
- ✅ Warning contains "CPU usage will be limited to 8 threads"

### Test 3: Resource Throttling Fields
**Objective:** Verify throttling fields are set correctly

**Steps:**
1. Check job data from Test 2

**Expected Results:**
- ✅ `resourceThrottled = true`
- ✅ `resourceThrottleReason = "AV1 source codec requires reduced CPU usage"`
- ✅ `ffmpegThreads = 8`

### Test 4: Encoding Start Logging
**Objective:** Verify throttling status is logged when encoding starts

**Steps:**
1. Wait for job to transition to ENCODING stage
2. Monitor backend logs:
   ```bash
   docker logs -f bitbonsai-backend-1 | grep -i "throttl"
   ```

**Expected Results:**
- ✅ Log shows: `[jobId] RESOURCE THROTTLED JOB STARTING`
- ✅ Log shows: `[jobId] Reason: AV1 source codec requires reduced CPU usage`
- ✅ Log shows: `[jobId] FFmpeg threads: 8`
- ✅ Log shows full warning message

### Test 5: FFmpeg Thread Limiting
**Objective:** Verify FFmpeg command includes `-threads 8` flag

**Steps:**
1. Wait for encoding to start (from Test 4)
2. Check FFmpeg command in logs:
   ```bash
   docker logs bitbonsai-backend-1 | grep "ffmpeg command"
   ```

**Expected Results:**
- ✅ FFmpeg command contains `-threads 8` before output path
- ✅ Log shows: `Using 8 threads (resource throttled: AV1 source codec requires reduced CPU usage)`

### Test 6: CPU Usage Monitoring
**Objective:** Verify CPU usage stays within limits

**Steps:**
1. While encoding is running, monitor CPU usage:
   ```bash
   htop
   # Or on Unraid:
   top
   ```

**Expected Results:**
- ✅ CPU usage does NOT max out all cores
- ✅ FFmpeg process uses approximately 8 threads (visible in htop)
- ✅ System remains responsive

### Test 7: Non-AV1 File Comparison
**Objective:** Verify non-AV1 files are NOT throttled

**Steps:**
1. Add a non-AV1 file (H.264 or HEVC) to library
2. Monitor job creation and encoding
3. Check job data via API

**Expected Results:**
- ✅ `resourceThrottled = false`
- ✅ `ffmpegThreads = null`
- ✅ `warning = null`
- ✅ No throttling logs in backend
- ✅ FFmpeg command does NOT contain `-threads` flag

## Verification Checklist

After running all tests, verify:

- [ ] AV1 files are detected correctly
- [ ] Warning message is accurate and prominent
- [ ] Throttling fields are populated
- [ ] FFmpeg uses only 8 threads for AV1 jobs
- [ ] CPU usage is controlled
- [ ] Non-AV1 files are NOT throttled
- [ ] All logs are clear and helpful
- [ ] No errors in backend logs

## Troubleshooting

### Issue: AV1 not detected
**Check:**
1. Is file codec actually AV1? Run:
   ```bash
   ffprobe -v error -select_streams v:0 -show_entries stream=codec_name \
     -of default=noprint_wrappers=1:nokey=1 \
     "/unraid-media/Movies/Spectre (2015)/Spectre (2015) WEBDL-2160p.mkv"
   ```
2. Are logs showing codec detection? Look for `probeVideoFile` logs

### Issue: Warning not showing in API
**Check:**
1. Was migration applied? Check database:
   ```sql
   SELECT * FROM jobs WHERE sourceCodec = 'av1' LIMIT 1;
   ```
2. Are warning fields in the schema? Check `prisma/schema.prisma`

### Issue: Thread limit not applied
**Check:**
1. Is `ffmpegThreads` field set in job record?
2. Are logs showing "Using X threads" message?
3. Is FFmpeg command showing `-threads 8` flag?

### Issue: CPU still maxed out
**Check:**
1. Verify FFmpeg is actually using the `-threads` flag (check command in logs)
2. Check if other processes are consuming CPU
3. Verify nice value is being applied (for priority jobs)

## Performance Metrics

Track these metrics during test:

| Metric | Before Throttling | After Throttling |
|--------|------------------|------------------|
| Max CPU Usage | ? | ~50-60% (with 8 threads) |
| FFmpeg Thread Count | ? | 8 |
| System Responsiveness | ? | Good |
| Job Completion | Failed after 36 retries | TBD |

## Success Criteria

The implementation is successful if:

1. ✅ AV1 files are automatically detected
2. ✅ Warning message is clear and informative
3. ✅ CPU usage is limited to ~8 threads
4. ✅ System remains stable during encoding
5. ✅ Users see estimated completion time
6. ✅ Non-AV1 files are NOT affected
7. ✅ All logs are helpful for debugging

## Next Steps After Testing

1. Monitor Spectre (2015) encoding progress
2. Verify job doesn't fail after 36 retries
3. Document actual encoding time vs. estimate
4. Consider adjusting 150x multiplier if needed
5. Plan frontend UI for displaying warnings
