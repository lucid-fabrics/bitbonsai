# Keep Original File Feature - Implementation Spec

## Overview
Allow users to preserve original files during encoding by clicking a "Keep Original" button while jobs are encoding.

## User Flow

### During Encoding
1. Original file stays at: `/path/movie.mkv` (untouched)
2. Encoding to temp: `/path/movie.tmp-12345.mkv`
3. UI shows **"Keep Original"** button on encoding jobs
4. User clicks button → Sets `keepOriginalRequested = true`
5. Button changes to **"✓ Keeping Original"** (green)

### On Completion
**If `keepOriginalRequested = true`:**
- Rename original: `movie.mkv` → `movie.mkv.original`
- Rename temp: `movie.tmp-12345.mkv` → `movie.mkv`
- Store: `originalBackupPath`, `originalSizeBytes`, `replacementAction='KEPT_BOTH'`

**If `keepOriginalRequested = false` (default):**
- Delete original: `rm movie.mkv`
- Rename temp: `movie.tmp-12345.mkv` → `movie.mkv`
- Store: `replacementAction='REPLACED'`

## Database Changes

### Prisma Schema (DONE ✓)
```prisma
model Job {
  // ... existing fields ...

  // Original File Tracking
  keepOriginalRequested Boolean @default(false)
  originalBackupPath    String?
  originalSizeBytes     BigInt?
  replacementAction     String? // 'REPLACED' | 'KEPT_BOTH'
}
```

**Migration:** `20251101235330_add_keep_original_fields` (APPLIED ✓)

## Backend Implementation

### 1. Queue Service (`apps/backend/src/queue/queue.service.ts`)

#### New Method: `requestKeepOriginal(jobId: string)`
```typescript
async requestKeepOriginal(jobId: string): Promise<Job> {
  const job = await this.findOne(jobId);

  if (job.stage !== JobStage.ENCODING) {
    throw new BadRequestException('Can only request keep-original for ENCODING jobs');
  }

  return this.prisma.job.update({
    where: { id: jobId },
    data: {
      keepOriginalRequested: true,
      originalSizeBytes: job.beforeSizeBytes, // Capture original size
    },
  });
}
```

#### Update: `completeJob()` Method
Modify file replacement logic at completion:

```typescript
// In apps/backend/src/encoding/ffmpeg.service.ts around line 560
if (job.keepOriginalRequested) {
  // Keep both: rename original to .original
  const originalBackupPath = `${job.filePath}.original`;
  await fs.rename(job.filePath, originalBackupPath);
  await fs.rename(tempOutput, job.filePath);

  // Update job with backup info
  await this.queueService.update(job.id, {
    originalBackupPath,
    originalSizeBytes: job.beforeSizeBytes,
    replacementAction: 'KEPT_BOTH',
  });
} else {
  // Default: replace original
  await fs.unlink(job.filePath); // Delete original
  await fs.rename(tempOutput, job.filePath);

  await this.queueService.update(job.id, {
    replacementAction: 'REPLACED',
  });
}
```

#### New Method: `deleteOriginalBackup(jobId: string)`
```typescript
async deleteOriginalBackup(jobId: string): Promise<{ freedSpace: bigint }> {
  const job = await this.findOne(jobId);

  if (!job.originalBackupPath) {
    throw new BadRequestException('No original backup exists for this job');
  }

  const size = job.originalSizeBytes || BigInt(0);
  await fs.unlink(job.originalBackupPath);

  await this.prisma.job.update({
    where: { id: jobId },
    data: {
      originalBackupPath: null,
      originalSizeBytes: null,
    },
  });

  return { freedSpace: size };
}
```

#### New Method: `restoreOriginal(jobId: string)`
```typescript
async restoreOriginal(jobId: string): Promise<Job> {
  const job = await this.findOne(jobId);

  if (!job.originalBackupPath) {
    throw new BadRequestException('No original backup to restore');
  }

  // Swap files back
  const encodedPath = `${job.filePath}.encoded`;
  await fs.rename(job.filePath, encodedPath); // Save encoded version
  await fs.rename(job.originalBackupPath, job.filePath); // Restore original

  return this.prisma.job.update({
    where: { id: jobId },
    data: {
      originalBackupPath: encodedPath, // Now .encoded is the backup
      replacementAction: 'KEPT_BOTH', // Still keeping both
    },
  });
}
```

### 2. Queue Controller (`apps/backend/src/queue/queue.controller.ts`)

Add three new endpoints:

#### POST `/queue/:id/keep-original`
```typescript
@Post(':id/keep-original')
@ApiOperation({ summary: 'Request to keep original file after encoding' })
async keepOriginal(@Param('id') id: string): Promise<Job> {
  return this.queueService.requestKeepOriginal(id);
}
```

#### DELETE `/queue/:id/original`
```typescript
@Delete(':id/original')
@ApiOperation({ summary: 'Delete original backup file to free space' })
async deleteOriginal(@Param('id') id: string) {
  return this.queueService.deleteOriginalBackup(id);
}
```

#### POST `/queue/:id/restore-original`
```typescript
@Post(':id/restore-original')
@ApiOperation({ summary: 'Restore original file (swap with encoded)' })
async restoreOriginal(@Param('id') id: string): Promise<Job> {
  return this.queueService.restoreOriginal(id);
}
```

## Frontend Implementation

### 1. Update Models (`apps/frontend/src/app/features/queue/models/`)

#### `queue-job.model.ts`
```typescript
export interface QueueJobModel {
  // ... existing fields ...

  // Keep Original Feature
  keepOriginalRequested: boolean;
  originalBackupPath: string | null;
  originalSizeBytes: string | null; // BigInt as string
  replacementAction: 'REPLACED' | 'KEPT_BOTH' | null;
}
```

### 2. Queue Client (`apps/frontend/src/app/core/clients/queue.client.ts`)

Add three methods:

```typescript
keepOriginal(jobId: string): Observable<QueueJobModel> {
  return this.http.post<QueueJobApiModel>(
    `${this.apiUrl}/queue/${jobId}/keep-original`,
    {}
  ).pipe(map(job => QueueJobBo.fromApi(job)));
}

deleteOriginal(jobId: string): Observable<{ freedSpace: string }> {
  return this.http.delete<{ freedSpace: string }>(
    `${this.apiUrl}/queue/${jobId}/original`
  );
}

restoreOriginal(jobId: string): Observable<QueueJobModel> {
  return this.http.post<QueueJobApiModel>(
    `${this.apiUrl}/queue/${jobId}/restore-original`,
    {}
  ).pipe(map(job => QueueJobBo.fromApi(job)));
}
```

### 3. Queue Page Component (`apps/frontend/src/app/features/queue/queue.page.ts`)

Add click handlers:

```typescript
onKeepOriginal(job: QueueJobModel): void {
  this.queueClient.keepOriginal(job.id).subscribe({
    next: (updatedJob) => {
      this.store.dispatch(QueueActions.updateJob({ job: updatedJob }));
      this.toastr.success(`Will keep original for: ${job.fileLabel}`);
    },
    error: (err) => this.toastr.error(`Failed: ${err.message}`),
  });
}

onDeleteOriginal(job: QueueJobModel): void {
  const confirmDelete = confirm(
    `Delete original file (${this.formatBytes(job.originalSizeBytes)})?\n` +
    `This will free up disk space but cannot be undone.`
  );

  if (!confirmDelete) return;

  this.queueClient.deleteOriginal(job.id).subscribe({
    next: ({ freedSpace }) => {
      this.store.dispatch(QueueActions.updateJob({ job: { ...job, originalBackupPath: null } }));
      this.toastr.success(`Freed ${this.formatBytes(freedSpace)}`);
    },
    error: (err) => this.toastr.error(`Failed: ${err.message}`),
  });
}

onRestoreOriginal(job: QueueJobModel): void {
  this.queueClient.restoreOriginal(job.id).subscribe({
    next: (updatedJob) => {
      this.store.dispatch(QueueActions.updateJob({ job: updatedJob }));
      this.toastr.success('Original file restored');
    },
    error: (err) => this.toastr.error(`Failed: ${err.message}`),
  });
}
```

### 4. Queue Page Template (`apps/frontend/src/app/features/queue/queue.page.html`)

#### For ENCODING Jobs:
```html
<div *ngIf="job.stage === 'ENCODING'" class="job-actions">
  <button
    *ngIf="!job.keepOriginalRequested"
    (click)="onKeepOriginal(job)"
    class="btn-secondary">
    💾 Keep Original
  </button>

  <button
    *ngIf="job.keepOriginalRequested"
    disabled
    class="btn-success">
    ✓ Keeping Original
  </button>
</div>
```

#### For COMPLETED Jobs:
```html
<div *ngIf="job.stage === 'COMPLETED'" class="job-details">
  <!-- File details -->
  <div class="file-info">
    <p>Encoded: {{ formatBytes(job.afterSizeBytes) }}</p>

    <p *ngIf="job.originalBackupPath">
      Original: {{ formatBytes(job.originalSizeBytes) }}
      <span class="badge-success">KEPT</span>
      <br>
      <small class="text-muted">{{ job.originalBackupPath }}</small>
    </p>

    <p *ngIf="!job.originalBackupPath && job.replacementAction === 'REPLACED'">
      Original: Deleted (freed {{ formatBytes(job.beforeSizeBytes - job.afterSizeBytes) }})
    </p>
  </div>

  <!-- Actions -->
  <div class="job-actions" *ngIf="job.originalBackupPath">
    <button (click)="onDeleteOriginal(job)" class="btn-danger">
      🗑️ Delete Original
    </button>
    <button (click)="onRestoreOriginal(job)" class="btn-secondary">
      ↩️ Restore Original
    </button>
  </div>
</div>
```

## Testing Plan

### Backend Tests
1. **Unit Tests** (`queue.service.spec.ts`):
   - `requestKeepOriginal()` - sets flag correctly
   - `completeJob()` - handles both keep/delete scenarios
   - `deleteOriginalBackup()` - removes file and updates DB
   - `restoreOriginal()` - swaps files correctly

2. **Integration Tests**:
   - Full encoding flow with `keepOriginalRequested=true`
   - Verify `.original` file created and tracked
   - Verify default behavior (delete original)

### Frontend Tests
1. **Component Tests** (`queue.page.spec.ts`):
   - Keep Original button shows for ENCODING jobs
   - Button disabled after clicking
   - Original file details display for COMPLETED jobs with backup

2. **E2E Tests** (`queue.spec.ts`):
   - Click "Keep Original" during encoding
   - Verify completion shows original kept
   - Delete and restore original actions work

## Implementation Order

1. ✅ **Database Schema** (DONE)
2. ✅ **Migration** (DONE)
3. **Backend - Queue Service** (implement methods)
4. **Backend - Queue Controller** (add endpoints)
5. **Backend - FFmpeg Service** (update completion logic)
6. **Frontend - Models** (add new fields)
7. **Frontend - Client** (add API methods)
8. **Frontend - UI** (buttons, badges, details)
9. **Deploy & Test**

## Deployment Notes

- **Database Migration**: Auto-applies on deployment (already done locally)
- **Backend Restart**: Required (Prisma client regenerated)
- **Frontend Build**: Required (new UI components)
- **Zero Downtime**: Feature is additive, no breaking changes
- **Rollback Plan**: New fields are nullable, can roll back safely

## Success Criteria

✅ User can click "Keep Original" during encoding
✅ Original file renamed to `.original` on completion
✅ Completed jobs show which action was taken
✅ User can delete `.original` files to free space
✅ User can restore original (swap files)
✅ Default behavior (delete original) unchanged
✅ All tests passing

---

**Status**: Database schema complete. Backend implementation in progress.
**Next Step**: Implement queue service methods.
