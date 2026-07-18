import { Dialog } from '@angular/cdk/dialog';
import { Injectable, inject } from '@angular/core';
import { catchError, EMPTY, firstValueFrom, Observable, of, tap } from 'rxjs';
import { ErrorLoggerService } from '../../../core/services/error-logger.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ConfirmationDialogComponent,
  type ConfirmationDialogData,
} from '../../../shared/components/confirmation-dialog/confirmation-dialog.component';
import type { QueueJobBo } from '../bos/queue-job.bo';
import {
  JobDelegationDialogComponent,
  type JobDelegationDialogData,
} from '../components/job-delegation-dialog/job-delegation-dialog.component';
import type {
  HealthCheckIssue,
  HealthCheckSuggestedAction,
} from '../models/health-check-issue.model';
import type { JobHistoryEvent } from '../models/job-history-event.model';
import type { QueueJob } from '../models/queue-job.model';
import { QueueService } from './queue.service';

@Injectable({
  providedIn: 'root',
})
export class QueueJobActionsService {
  private readonly queueService = inject(QueueService);
  private readonly toastService = inject(ToastService);
  private readonly errorLogger = inject(ErrorLoggerService);
  private readonly dialog = inject(Dialog);

  // ============================================================================
  // Single-job mutations - return Observable, caller subscribes
  // ============================================================================

  cancelJob(jobId: string, blacklist: boolean): Observable<void> {
    return this.queueService.cancelJob(jobId, blacklist).pipe(
      tap(() => {
        this.toastService.success(blacklist ? 'Job cancelled and blacklisted' : 'Job cancelled');
      }),
      catchError(() => {
        this.toastService.error('Failed to cancel job');
        return EMPTY;
      })
    );
  }

  retryJob(jobId: string): Observable<void> {
    return this.queueService.retryJob(jobId).pipe(
      tap(() => {
        this.toastService.success('Job moved back to queue');
      }),
      catchError(() => {
        this.toastService.error('Failed to retry job');
        return EMPTY;
      })
    );
  }

  unblockJob(jobId: string): Observable<void> {
    return this.queueService.unblacklistJob(jobId).pipe(
      tap(() => {
        this.toastService.success('File unblocked. It can now be retried');
      }),
      catchError(() => {
        this.toastService.error('Failed to unblock job');
        return EMPTY;
      })
    );
  }

  recheckJob(jobId: string): Observable<QueueJobBo> {
    return this.queueService.recheckJob(jobId).pipe(
      tap((updatedJob) => {
        if (updatedJob.stage === 'COMPLETED') {
          this.toastService.success('Job rechecked and moved to COMPLETED');
        } else {
          this.toastService.warning('Job still FAILED after recheck - file is invalid or missing');
        }
      }),
      catchError((err: { error?: { message?: string } }) => {
        this.toastService.error(`Failed to recheck job: ${err.error?.message || 'Unknown error'}`);
        return EMPTY;
      })
    );
  }

  detectAndRequeue(jobId: string): Observable<QueueJobBo> {
    return this.queueService.detectAndRequeue(jobId).pipe(
      tap((updatedJob) => {
        if (updatedJob.stage === 'QUEUED') {
          this.toastService.success('No compression detected - job requeued for retry');
        } else {
          this.toastService.info('Compression was successful - no action taken');
        }
      }),
      catchError((err: { error?: { message?: string } }) => {
        const message = err.error?.message || 'Unknown error';
        if (message.includes('successfully compressed')) {
          this.toastService.info(message);
        } else {
          this.toastService.error(`Failed to detect compression: ${message}`);
        }
        return EMPTY;
      })
    );
  }

  setPriority(jobId: string, priority: number): Observable<QueueJobBo> {
    return this.queueService.updateJobPriority(jobId, priority).pipe(
      tap(() => {
        const priorityNames = ['Normal', 'High', 'Top Priority'];
        this.toastService.success(`Priority set to ${priorityNames[priority]}`);
      }),
      catchError((err: { error?: { message?: string } }) => {
        const errorMessage = err?.error?.message || 'Failed to update priority';
        this.toastService.error(errorMessage);
        return EMPTY;
      })
    );
  }

  pauseJob(jobId: string): Observable<void> {
    return this.queueService.pauseJob(jobId).pipe(
      tap(() => {
        this.toastService.info('Job paused');
      }),
      catchError(() => {
        this.toastService.error('Failed to pause job');
        return EMPTY;
      })
    );
  }

  resumeJob(jobId: string): Observable<void> {
    return this.queueService.resumeJob(jobId).pipe(
      tap(() => {
        this.toastService.info('Job resumed');
      }),
      catchError(() => {
        this.toastService.error('Failed to resume job');
        return EMPTY;
      })
    );
  }

  captureCurrentFrame(jobId: string): Observable<QueueJobBo> {
    return this.queueService.capturePreview(jobId).pipe(
      tap(() => {
        this.toastService.success('Preview captured successfully');
      }),
      catchError((err: { error?: { message?: string } }) => {
        this.toastService.error(err?.error?.message || 'Failed to capture preview');
        return EMPTY;
      })
    );
  }

  forceStartJob(jobId: string): Observable<void> {
    return this.queueService.forceStartJob(jobId).pipe(
      tap(() => {
        this.toastService.success('Job prioritized and will start encoding within seconds');
      }),
      catchError(() => {
        this.toastService.error('Failed to force-start job');
        return EMPTY;
      })
    );
  }

  keepOriginal(job: QueueJob): Observable<QueueJobBo> {
    return this.queueService.keepOriginal(job.id).pipe(
      tap(() => {
        this.toastService.success(`Will keep original for: ${job.fileName}`);
      }),
      catchError((err: { error?: { message?: string } }) => {
        const errorMessage = err?.error?.message || 'Failed to keep original';
        this.toastService.error(errorMessage);
        return EMPTY;
      })
    );
  }

  restoreOriginal(job: QueueJob): Observable<QueueJobBo> {
    return this.queueService.restoreOriginal(job.id).pipe(
      tap(() => {
        this.toastService.success('Original file restored');
      }),
      catchError((err: { error?: { message?: string } }) => {
        const errorMessage = err?.error?.message || 'Failed to restore original';
        this.toastService.error(errorMessage);
        return EMPTY;
      })
    );
  }

  // ============================================================================
  // Dialog-based mutations - open confirmation dialog then act
  // ============================================================================

  deleteJob(job: QueueJobBo): Observable<void> {
    const dialogData: ConfirmationDialogData = {
      title: 'Delete Job Entry?',
      itemName: job.fileName,
      itemType: 'job entry',
      willHappen: [
        'Permanently remove this job record from the database',
        'Clean up the queue view',
      ],
      wontHappen: [
        'Delete or modify the actual media file',
        'Affect other jobs or their progress',
        'Delete any encoded videos',
      ],
      irreversible: true,
      confirmButtonText: 'Delete Job Entry',
      cancelButtonText: 'Keep Job Entry',
    };

    const dialogRef = this.dialog.open<boolean>(ConfirmationDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    return new Observable<void>((subscriber) => {
      dialogRef.closed.subscribe((result) => {
        if (result !== true) {
          subscriber.complete();
          return;
        }
        this.queueService
          .deleteJob(job.id)
          .pipe(
            tap(() => {
              this.toastService.success('Job deleted successfully');
            }),
            catchError((err: { error?: { message?: string } }) => {
              const errorMessage = err?.error?.message || 'Failed to delete job';
              this.toastService.error(errorMessage);
              return EMPTY;
            })
          )
          .subscribe({
            next: () => {
              subscriber.next();
              subscriber.complete();
            },
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });
      });
    });
  }

  deleteOriginal(job: QueueJob): Observable<void> {
    const sizeInMB = job.originalSizeBytes
      ? (job.originalSizeBytes / (1024 * 1024)).toFixed(2)
      : '0';

    const dialogData: ConfirmationDialogData = {
      title: 'Delete Original File?',
      itemName: job.fileName || 'Original file',
      itemType: 'video file',
      willHappen: [`Free up ${sizeInMB} MB of disk space`, 'Remove the source file permanently'],
      wontHappen: ['Affect the encoded output file', 'Remove the job from history'],
      irreversible: true,
      confirmButtonText: 'Delete Original',
      cancelButtonText: 'Keep File',
    };

    const dialogRef = this.dialog.open<boolean>(ConfirmationDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    return new Observable<void>((subscriber) => {
      dialogRef.closed.subscribe((confirmed) => {
        if (confirmed !== true) {
          subscriber.complete();
          return;
        }
        this.queueService
          .deleteOriginal(job.id)
          .pipe(
            tap((result) => {
              const freedMB = (Number(result.freedSpace) / (1024 * 1024)).toFixed(2);
              this.toastService.success(`Freed ${freedMB} MB of disk space`);
            }),
            catchError((err: { error?: { message?: string } }) => {
              const errorMessage = err?.error?.message || 'Failed to delete original';
              this.toastService.error(errorMessage);
              return EMPTY;
            })
          )
          .subscribe({
            next: () => {
              subscriber.next();
              subscriber.complete();
            },
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });
      });
    });
  }

  openDelegationDialog(job: QueueJobBo): Observable<boolean> {
    const dialogData: JobDelegationDialogData = { job };
    const dialogRef = this.dialog.open<boolean>(JobDelegationDialogComponent, {
      data: dialogData,
      disableClose: false,
      width: '600px',
    });

    return new Observable<boolean>((subscriber) => {
      dialogRef.closed.subscribe((result) => {
        if (result === true) {
          this.toastService.success('Job delegated successfully');
        }
        subscriber.next(result === true);
        subscriber.complete();
      });
    });
  }

  // ============================================================================
  // Bulk mutations
  // ============================================================================

  cancelAllQueued(): Observable<{ cancelledCount: number }> {
    return this.queueService.cancelAllQueued().pipe(
      tap((result) => {
        const count = result.cancelledCount;
        this.toastService.success(count === 1 ? '1 job cancelled' : `${count} jobs cancelled`);
      }),
      catchError(() => {
        this.toastService.error('Failed to cancel jobs');
        return EMPTY;
      })
    );
  }

  skipAllCodecMatch(): Observable<{ skippedCount: number }> {
    return this.queueService.skipAllCodecMatch().pipe(
      tap((result) => {
        const count = result.skippedCount;
        if (count === 0) {
          this.toastService.info('No codec-match jobs found to skip');
        } else {
          this.toastService.success(
            count === 1
              ? '1 job marked as completed (codec already matches)'
              : `${count} jobs marked as completed (codec already matches)`
          );
        }
      }),
      catchError(() => {
        this.toastService.error('Failed to skip codec-match jobs');
        return EMPTY;
      })
    );
  }

  forceEncodeAllCodecMatch(): Observable<{ queuedCount: number }> {
    return this.queueService.forceEncodeAllCodecMatch().pipe(
      tap((result) => {
        const count = result.queuedCount;
        if (count === 0) {
          this.toastService.info('No codec-match jobs found to re-encode');
        } else {
          this.toastService.success(
            count === 1 ? '1 job queued for re-encoding' : `${count} jobs queued for re-encoding`
          );
        }
      }),
      catchError(() => {
        this.toastService.error('Failed to queue codec-match jobs for re-encoding');
        return EMPTY;
      })
    );
  }

  retryAllCancelled(): Observable<{ retriedCount: number }> {
    return this.queueService.retryAllCancelled().pipe(
      tap((result) => {
        const count = result.retriedCount;
        this.toastService.success(
          count === 1 ? '1 job moved back to queue' : `${count} jobs moved back to queue`
        );
      }),
      catchError(() => {
        this.toastService.error('Failed to retry jobs');
        return EMPTY;
      })
    );
  }

  retryAllFailed(errorFilter?: string): Observable<{ retriedCount: number }> {
    return this.queueService.retryAllFailed(errorFilter).pipe(
      tap((result) => {
        const count = result.retriedCount;
        this.toastService.success(
          count === 1
            ? '1 failed job moved back to queue'
            : `${count} failed jobs moved back to queue`
        );
      }),
      catchError(() => {
        this.toastService.error('Failed to retry failed jobs');
        return EMPTY;
      })
    );
  }

  clearJobs(stages?: string[]): Observable<{ deleted: number }> {
    return this.queueService.clearJobs(stages).pipe(
      tap((result) => {
        const count = result.deleted;
        this.toastService.success(count === 1 ? '1 job deleted' : `${count} jobs deleted`);
      }),
      catchError(() => {
        this.toastService.error('Failed to clear jobs');
        return EMPTY;
      })
    );
  }

  rebalanceJobs(): Observable<{ jobsRebalanced: number }> {
    return this.queueService.rebalanceJobs().pipe(
      tap((result) => {
        const count = result.jobsRebalanced;
        if (count > 0) {
          this.toastService.success(
            count === 1
              ? '1 job redistributed across nodes'
              : `${count} jobs redistributed across nodes`
          );
        } else {
          this.toastService.info('No rebalancing needed - jobs are already well distributed');
        }
      }),
      catchError(() => {
        this.toastService.error('Failed to rebalance jobs');
        return EMPTY;
      })
    );
  }

  // ============================================================================
  // Decision resolution
  // ============================================================================

  async resolveDecision(
    jobId: string,
    event: { issue: HealthCheckIssue; action: HealthCheckSuggestedAction }
  ): Promise<void> {
    this.toastService.info(`Applying fix: ${event.action.label}...`);

    try {
      const result = await firstValueFrom(
        this.queueService.resolveDecision(jobId, event.action.config || {}),
        { defaultValue: null }
      );

      if (result === null) {
        this.toastService.error('No response from server');
        return;
      }

      this.toastService.success(`${event.action.label} applied successfully. Job moved to queue.`);
    } catch (error: unknown) {
      this.errorLogger.error('Failed to resolve decision', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.toastService.error(`Failed to apply fix: ${errorMessage}`);
    }
  }

  // ============================================================================
  // Job history fetch (used in both expand-row and modal flows)
  // ============================================================================

  loadJobHistory(jobId: string): Observable<JobHistoryEvent[]> {
    return this.queueService.getJobHistory(jobId).pipe(
      catchError((error: unknown) => {
        this.errorLogger.error(`Failed to fetch job history for ${jobId}`, error);
        this.toastService.error('Failed to load job history');
        return of([] as JobHistoryEvent[]);
      })
    );
  }
}
