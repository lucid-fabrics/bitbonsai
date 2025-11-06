# Encoding Preview Feature - Implementation Guide

## Overview
Display live screenshots of encoded video during encoding to let users peek at what's being encoded without impacting performance.

## Status
- ✅ Database schema updated (`previewImagePaths` field added)
- ✅ Migration applied (`20251104030622_add_encoding_preview_paths`)
- ⏳ Backend service (pending)
- ⏳ API endpoint (pending)
- ⏳ Frontend display (pending)

---

## 1. Backend: Encoding Preview Service

### File: `apps/backend/src/encoding/encoding-preview.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

const execFileAsync = promisify(execFile);

/**
 * EncodingPreviewService
 *
 * Generates preview screenshots from encoding temp files.
 * Designed to minimize performance impact on encoding process.
 *
 * Strategy:
 * - Extract 4 frames at 25%, 50%, 75%, and latest encoded position
 * - Use FFmpeg's fast seeking to avoid decoding entire file
 * - Run extraction asynchronously in separate process
 * - Store in `/tmp/bitbonsai-previews/{jobId}/`
 * - Clean up automatically when job completes/fails
 */
@Injectable()
export class EncodingPreviewService {
  private readonly logger = new Logger(EncodingPreviewService.name);
  private readonly PREVIEW_DIR = '/tmp/bitbonsai-previews';
  private readonly PREVIEW_WIDTH = 640; // Small size for fast loading
  private readonly PREVIEW_COUNT = 4; // Number of screenshots

  /**
   * Generate preview screenshots from temp file
   *
   * @param jobId - Job ID
   * @param tempFilePath - Path to temp encoded file
   * @param durationSeconds - Total video duration
   * @param currentProgress - Current encoding progress (0-100)
   * @returns Array of preview image paths
   */
  async generatePreviews(
    jobId: string,
    tempFilePath: string,
    durationSeconds: number,
    currentProgress: number
  ): Promise<string[]> {
    try {
      // Create preview directory for this job
      const jobPreviewDir = path.join(this.PREVIEW_DIR, jobId);
      await fs.mkdir(jobPreviewDir, { recursive: true });

      // Calculate timestamps for preview extraction
      // Extract at 25%, 50%, 75%, and current progress point
      const progressPoint = (currentProgress / 100) * durationSeconds;
      const timestamps = [
        durationSeconds * 0.25,
        durationSeconds * 0.50,
        durationSeconds * 0.75,
        Math.min(progressPoint, durationSeconds), // Don't exceed duration
      ];

      const previewPaths: string[] = [];

      // Extract screenshots in parallel
      await Promise.all(
        timestamps.map(async (timestamp, index) => {
          const outputPath = path.join(jobPreviewDir, `preview-${index + 1}.jpg`);

          try {
            // Use FFmpeg with fast seeking
            // -ss before -i for input seeking (faster)
            // -frames:v 1 to extract single frame
            // -vf scale to resize for fast transfer
            await execFileAsync('ffmpeg', [
              '-y', // Overwrite existing
              '-ss',
              timestamp.toString(),
              '-i',
              tempFilePath,
              '-frames:v',
              '1',
              '-vf',
              `scale=${this.PREVIEW_WIDTH}:-1`, // Maintain aspect ratio
              '-q:v',
              '2', // High quality JPEG
              outputPath,
            ], {
              timeout: 10000, // 10 second timeout per frame
            });

            previewPaths.push(outputPath);
            this.logger.debug(
              `Generated preview ${index + 1}/4 for job ${jobId} at ${timestamp.toFixed(1)}s`
            );
          } catch (error) {
            this.logger.warn(
              `Failed to generate preview ${index + 1} for job ${jobId}: ${error.message}`
            );
            // Continue with other previews even if one fails
          }
        })
      );

      return previewPaths;
    } catch (error) {
      this.logger.error(`Failed to generate previews for job ${jobId}:`, error);
      return [];
    }
  }

  /**
   * Clean up preview images for a job
   *
   * @param jobId - Job ID
   */
  async cleanupPreviews(jobId: string): Promise<void> {
    try {
      const jobPreviewDir = path.join(this.PREVIEW_DIR, jobId);
      await fs.rm(jobPreviewDir, { recursive: true, force: true });
      this.logger.debug(`Cleaned up previews for job ${jobId}`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup previews for job ${jobId}:`, error);
    }
  }

  /**
   * Get preview image paths for a job
   *
   * @param jobId - Job ID
   * @returns Array of preview image paths (empty if none exist)
   */
  async getPreviewPaths(jobId: string): Promise<string[]> {
    try {
      const jobPreviewDir = path.join(this.PREVIEW_DIR, jobId);
      const files = await fs.readdir(jobPreviewDir);
      return files
        .filter(f => f.startsWith('preview-') && f.endsWith('.jpg'))
        .sort() // Ensure correct order
        .map(f => path.join(jobPreviewDir, f));
    } catch {
      return []; // Directory doesn't exist or is empty
    }
  }
}
```

### Module Registration

Add to `apps/backend/src/encoding/encoding.module.ts`:

```typescript
import { EncodingPreviewService } from './encoding-preview.service';

@Module({
  providers: [
    // ... existing providers
    EncodingPreviewService,
  ],
  exports: [
    // ... existing exports
    EncodingPreviewService,
  ],
})
export class EncodingModule {}
```

---

## 2. Integration with FFmpeg Service

### Update: `apps/backend/src/encoding/ffmpeg.service.ts`

Add preview generation during encoding progress updates:

```typescript
import { EncodingPreviewService } from './encoding-preview.service';

export class FfmpegService {
  constructor(
    // ... existing dependencies
    private readonly previewService: EncodingPreviewService,
  ) {}

  private async handleProgressUpdate(/* ... */): Promise<void> {
    // ... existing progress update logic

    // Generate previews every 30 seconds (throttled)
    const shouldGeneratePreviews =
      job.stage === JobStage.ENCODING &&
      job.tempFilePath &&
      (!job.lastProgressUpdate ||
        Date.now() - job.lastProgressUpdate.getTime() > 30000);

    if (shouldGeneratePreviews) {
      // Run preview generation asynchronously (don't await)
      this.generatePreviewsAsync(job.id, job.tempFilePath, videoDuration, progress);
    }
  }

  private async generatePreviewsAsync(
    jobId: string,
    tempFilePath: string,
    durationSeconds: number,
    currentProgress: number
  ): Promise<void> {
    try {
      const previewPaths = await this.previewService.generatePreviews(
        jobId,
        tempFilePath,
        durationSeconds,
        currentProgress
      );

      // Update job with preview paths
      if (previewPaths.length > 0) {
        await this.prisma.job.update({
          where: { id: jobId },
          data: {
            previewImagePaths: JSON.stringify(previewPaths),
          },
        });
      }
    } catch (error) {
      this.logger.warn(`Preview generation failed for job ${jobId}:`, error);
      // Don't fail the encoding job if previews fail
    }
  }

  // Clean up previews when job completes or fails
  private async cleanup(jobId: string): Promise<void> {
    // ... existing cleanup logic
    await this.previewService.cleanupPreviews(jobId);
  }
}
```

---

## 3. API Endpoint: Serve Preview Images

### File: `apps/backend/src/queue/queue.controller.ts`

```typescript
import { Response } from 'express';
import { createReadStream } from 'fs';
import { access } from 'fs/promises';

@Controller('queue')
export class QueueController {
  // ... existing endpoints

  /**
   * GET /api/v1/queue/:id/preview/:index
   * Serve preview image for encoding job
   */
  @Get(':id/preview/:index')
  async getPreview(
    @Param('id') jobId: string,
    @Param('index') index: string,
    @Res() res: Response,
  ): Promise<void> {
    const previewIndex = parseInt(index, 10);
    if (isNaN(previewIndex) || previewIndex < 1 || previewIndex > 4) {
      throw new BadRequestException('Invalid preview index (must be 1-4)');
    }

    // Get job to verify it exists and has previews
    const job = await this.queueService.findOne(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    if (!job.previewImagePaths) {
      throw new NotFoundException(`No previews available for job ${jobId}`);
    }

    const previewPaths = JSON.parse(job.previewImagePaths) as string[];
    const previewPath = previewPaths[previewIndex - 1];

    if (!previewPath) {
      throw new NotFoundException(`Preview ${previewIndex} not found`);
    }

    // Verify file exists
    try {
      await access(previewPath);
    } catch {
      throw new NotFoundException(`Preview image file not found`);
    }

    // Stream the image
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=60'); // Cache for 1 minute
    createReadStream(previewPath).pipe(res);
  }
}
```

---

## 4. Frontend: Job Details Modal Preview Display

### File: `apps/frontend/src/app/features/queue/components/job-details-modal/job-details-modal.component.ts`

```typescript
export interface JobDetailsModalData {
  job: Job;
}

@Component({
  selector: 'app-job-details-modal',
  templateUrl: './job-details-modal.component.html',
  styleUrls: ['./job-details-modal.component.scss'],
})
export class JobDetailsModalComponent implements OnInit, OnDestroy {
  job: Job;
  previewUrls: string[] = [];
  currentPreviewIndex = 0;
  autoRefreshInterval?: number;

  ngOnInit(): void {
    this.job = this.data.job;
    this.loadPreviews();

    // Auto-refresh previews every 15 seconds if encoding
    if (this.job.stage === 'ENCODING') {
      this.autoRefreshInterval = window.setInterval(() => {
        this.loadPreviews();
      }, 15000);
    }
  }

  ngOnDestroy(): void {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
    }
  }

  loadPreviews(): void {
    if (!this.job.previewImagePaths) {
      return;
    }

    try {
      const paths = JSON.parse(this.job.previewImagePaths) as string[];
      this.previewUrls = paths.map((_, index) =>
        `/api/v1/queue/${this.job.id}/preview/${index + 1}?t=${Date.now()}`
      );
    } catch (error) {
      console.error('Failed to parse preview paths:', error);
    }
  }

  nextPreview(): void {
    this.currentPreviewIndex = (this.currentPreviewIndex + 1) % this.previewUrls.length;
  }

  prevPreview(): void {
    this.currentPreviewIndex =
      (this.currentPreviewIndex - 1 + this.previewUrls.length) % this.previewUrls.length;
  }

  selectPreview(index: number): void {
    this.currentPreviewIndex = index;
  }
}
```

### Template: `job-details-modal.component.html`

Add preview section after job details:

```html
<!-- Encoding Previews (only show if encoding) -->
<div *ngIf="job.stage === 'ENCODING' && previewUrls.length > 0" class="preview-section">
  <h4 class="preview-title">
    <i class="fas fa-images"></i>
    Encoding Preview
  </h4>

  <!-- Main preview image -->
  <div class="preview-carousel">
    <button class="preview-nav prev" (click)="prevPreview()" *ngIf="previewUrls.length > 1">
      <i class="fas fa-chevron-left"></i>
    </button>

    <div class="preview-main">
      <img
        [src]="previewUrls[currentPreviewIndex]"
        alt="Encoding preview"
        class="preview-image"
        (error)="loadPreviews()"
      />
      <div class="preview-label">
        Frame {{ currentPreviewIndex + 1 }} of {{ previewUrls.length }}
      </div>
    </div>

    <button class="preview-nav next" (click)="nextPreview()" *ngIf="previewUrls.length > 1">
      <i class="fas fa-chevron-right"></i>
    </button>
  </div>

  <!-- Thumbnail navigation -->
  <div class="preview-thumbnails" *ngIf="previewUrls.length > 1">
    <div
      *ngFor="let url of previewUrls; let i = index"
      class="preview-thumb"
      [class.active]="i === currentPreviewIndex"
      (click)="selectPreview(i)"
    >
      <img [src]="url" alt="Preview {{ i + 1 }}" />
    </div>
  </div>

  <p class="preview-note">
    <i class="fas fa-info-circle"></i>
    Preview updates automatically every 15 seconds
  </p>
</div>
```

### Styles: `job-details-modal.component.scss`

```scss
.preview-section {
  margin-top: 24px;
  padding: 20px;
  background: rgba($bg-tertiary, 0.5);
  border-radius: 12px;
  border: 1px solid $border-secondary;

  .preview-title {
    font-size: 16px;
    font-weight: 600;
    color: $text-white;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 10px;

    i {
      color: $accent-primary;
    }
  }

  .preview-carousel {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;

    .preview-nav {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: $bg-tertiary;
      border: 1px solid $border-secondary;
      color: $text-secondary;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: $transition-fast;

      &:hover {
        background: $bg-secondary;
        border-color: $accent-primary;
        color: $accent-primary;
      }
    }

    .preview-main {
      flex: 1;
      position: relative;
      border-radius: 8px;
      overflow: hidden;
      background: $bg-primary;
      border: 1px solid $border-secondary;

      .preview-image {
        width: 100%;
        height: auto;
        display: block;
      }

      .preview-label {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
        color: $text-white;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 500;
      }
    }
  }

  .preview-thumbnails {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-bottom: 12px;

    .preview-thumb {
      width: 80px;
      height: 45px;
      border-radius: 4px;
      overflow: hidden;
      cursor: pointer;
      border: 2px solid transparent;
      transition: $transition-fast;

      &.active {
        border-color: $accent-primary;
      }

      &:hover {
        border-color: rgba($accent-primary, 0.5);
      }

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }
  }

  .preview-note {
    font-size: 12px;
    color: $text-tertiary;
    text-align: center;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;

    i {
      opacity: 0.7;
    }
  }
}
```

---

## 5. Testing

### Manual Testing Steps

1. **Start an encoding job**
   ```bash
   # Start a job through the UI or API
   curl -X POST http://localhost:3100/api/v1/queue \
     -H "Content-Type: application/json" \
     -d '{"filePath": "/path/to/video.mkv", ...}'
   ```

2. **Wait 30 seconds** for first previews to generate

3. **Open job details modal** in frontend

4. **Verify previews display:**
   - Should see 4 preview frames
   - Navigation arrows work
   - Thumbnail selection works
   - Auto-refresh every 15 seconds

5. **Check preview cleanup:**
   ```bash
   # After job completes, verify cleanup
   ls /tmp/bitbonsai-previews/
   # Should be empty or not contain completed job IDs
   ```

### Performance Testing

Monitor encoding FPS before and after preview generation:
- Should have minimal impact (<2% FPS drop)
- Preview generation runs asynchronously
- Failures don't crash encoding

---

## 6. Deployment Checklist

- [ ] Apply migration on Unraid: `prisma migrate deploy`
- [ ] Update backend code
- [ ] Update frontend code
- [ ] Restart containers: `./deploy-unraid.sh`
- [ ] Verify `/tmp/bitbonsai-previews` directory is writable
- [ ] Test with active encoding job
- [ ] Monitor logs for errors
- [ ] Check cleanup works after job completion

---

## Performance Considerations

1. **FFmpeg Fast Seeking:** Input seeking (`-ss` before `-i`) is 10-100x faster than output seeking
2. **Small Images:** 640px width ensures fast transfer and rendering
3. **Throttled Generation:** Only generate previews every 30 seconds to minimize overhead
4. **Async Execution:** Preview generation doesn't block encoding process
5. **Graceful Degradation:** Failed preview generation doesn't fail the encoding job

---

## Future Enhancements

- [ ] Add video quality comparison (before/after frames side-by-side)
- [ ] Show encoding statistics overlay on previews
- [ ] Allow user to select specific timestamps for preview
- [ ] Add fullscreen preview mode
- [ ] Generate preview GIF animation
