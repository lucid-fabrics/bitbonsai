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
