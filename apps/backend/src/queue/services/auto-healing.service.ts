import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobEventType, JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { JobHistoryRepository } from '../../common/repositories/job-history.repository';
import { SettingsRepository } from '../../common/repositories/settings.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { RetrySchedulerService } from './retry-scheduler.service';

// Stale-lock expiry for the hourly cron overlap guard
const CRON_LOCK_STALE_MS = 2 * 60 * 60 * 1000;

/**
 * AutoHealingService
 *
 * Automatically recovers failed jobs. Runs at application startup and then
 * hourly, so jobs past the 5-minute scheduler's cap (retryCount 3-14) no
 * longer wait for a backend restart to get another attempt.
 *
 * Recovery Criteria:
 * - Job must be in FAILED stage
 * - retryCount must be < maxAutoHealRetries (configurable, default: 15)
 * - Respects nextRetryAt timestamp (exponential backoff)
 * - Skips circuit-broken jobs and jobs failed as non-retriable
 */
@Injectable()
export class AutoHealingService implements OnModuleInit {
  private readonly logger = new Logger(AutoHealingService.name);

  // PERF: Cache settings to avoid repeated DB queries
  private settingsCache: { maxRetries: number; cachedAt: number } | null = null;
  private readonly SETTINGS_CACHE_TTL_MS = 60000; // 1 minute cache

  // Overlap guard for the hourly cron (same pattern as HealthCheckWorker)
  private cronRunning = false;
  private cronLockExpiry = 0;

  constructor(
    private readonly jobHistoryRepository: JobHistoryRepository,
    private readonly jobRepository: JobRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly nodeConfig: NodeConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly retryScheduler: RetrySchedulerService
  ) {}

  /**
   * Runs automatically when the module initializes (container startup)
   */
  async onModuleInit(): Promise<void> {
    // Only MAIN node owns the DB and should heal jobs cluster-wide.
    // LINKED nodes running this would re-queue all FAILED jobs on every restart,
    // burning through maxAutoHealRetries for every job they don't own.
    if (!this.nodeConfig.isMainNode()) {
      this.logger.log('Skipping auto-healing on LINKED node (MAIN node responsibility)');
      return;
    }
    this.logger.log('Auto-healing service initializing...');
    await this.healFailedJobs();
  }

  /**
   * Hourly heal pass so steady-state FAILED jobs past the retry scheduler's
   * cap (retryCount >= 3) get further attempts without a backend restart.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async healFailedJobsCron(): Promise<void> {
    if (!this.nodeConfig.isMainNode()) return;

    const now = Date.now();
    if (this.cronRunning && now - this.cronLockExpiry < CRON_LOCK_STALE_MS) {
      this.logger.warn('Auto-heal cron already running, skipping this tick');
      return;
    }
    if (this.cronRunning) {
      this.logger.warn('Auto-heal cron lock is stale, resetting and proceeding');
    }
    this.cronRunning = true;
    this.cronLockExpiry = now;
    try {
      await this.healFailedJobs();
    } finally {
      this.cronRunning = false;
    }
  }

  /**
   * PERF: Get max retry limit with caching
   * Caches settings for 1 minute to avoid repeated DB queries
   * @private
   */
  private async getMaxRetries(): Promise<number> {
    const now = Date.now();

    // Return cached value if still valid
    if (this.settingsCache && now - this.settingsCache.cachedAt < this.SETTINGS_CACHE_TTL_MS) {
      return this.settingsCache.maxRetries;
    }

    // Fetch fresh settings
    const settings = await this.settingsRepository.findFirst();
    const maxRetries = settings?.maxAutoHealRetries ?? 15;

    // Update cache
    this.settingsCache = { maxRetries, cachedAt: now };

    return maxRetries;
  }

  /**
   * Recover all eligible failed jobs
   *
   * Finds failed jobs that:
   * - Have retry attempts remaining (retryCount < maxAutoHealRetries from settings)
   * - nextRetryAt is null or in the past
   * - Not permanently failed (circuit-broken or classified non-retriable)
   *
   * @returns Number of jobs healed
   */
  async healFailedJobs(): Promise<number> {
    try {
      const now = new Date();

      // PERF: Get max retry limit with caching
      const maxRetries = await this.getMaxRetries();
      this.logger.log(`Auto-heal max retry limit: ${maxRetries}`);

      // Find eligible failed jobs. Excluded: circuit-broken jobs and jobs the
      // retry strategy deliberately failed as non-retriable (corrupted source)
      // - resurrecting those just burns full encode passes on doomed files.
      // The `error: null` OR-branch is load-bearing: Prisma's NOT+startsWith
      // compiles to NOT(LIKE), which excludes NULL rows in SQL.
      const eligibleJobs = await this.jobRepository.findManySelect<{
        id: string;
        fileLabel: string;
        retryCount: number;
        nextRetryAt: Date | null;
        progress: number;
      }>(
        {
          stage: JobStage.FAILED,
          circuitBroken: false,
          retryCount: { lt: maxRetries },
          AND: [
            { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
            { OR: [{ error: null }, { NOT: { error: { startsWith: 'Non-retriable' } } }] },
          ],
        },
        {
          id: true,
          fileLabel: true,
          retryCount: true,
          nextRetryAt: true,
          progress: true,
        }
      );

      if (eligibleJobs.length === 0) {
        this.logger.log('No failed jobs eligible for auto-healing');
        return 0;
      }

      this.logger.log(`Found ${eligibleJobs.length} failed job(s) eligible for retry`);

      // Reset jobs back to QUEUED individually to capture progress at healing point
      let healedCount = 0;
      for (const job of eligibleJobs) {
        try {
          // Input-seek resume was removed (truncated outputs); recovery
          // restarts from 0. Segmented jobs resume via their JobSegment rows.
          this.logger.log(
            `Healed job: ${job.fileLabel} (retry ${job.retryCount + 1}/${maxRetries}, restarting from 0%)`
          );

          // Circuit breaker: increment totalAttempts and permanently fail if threshold reached.
          // This ensures repeated auto-heal cycles don't loop forever on a persistently broken job.
          const broke = await this.circuitBreaker.checkAndBreak(job.id, 'auto-heal-retry');
          if (broke) {
            this.logger.warn(
              `Circuit breaker tripped for ${job.fileLabel} - permanently excluded after ${job.retryCount} auto-heal attempts`
            );
            continue;
          }

          // Compute exponential backoff window for the attempt after this one,
          // so the job won't be immediately re-healed on the next cycle.
          const nextAttempt = job.retryCount + 1;
          const delayMs = this.retryScheduler.computeNextRetryDelay(nextAttempt + 1);
          const nextRetryAt = new Date(Date.now() + delayMs);

          await this.jobRepository.updateById(job.id, {
            stage: JobStage.QUEUED,
            progress: 0,
            error: null,
            completedAt: null,
            startedAt: null,
            retryCount: nextAttempt,
            nextRetryAt,
            autoHealedAt: new Date(),
            autoHealedProgress: job.progress || 0, // Record original progress for history
            resumeTimestamp: null,
            tempFilePath: null,
          });

          // AUDIT TRAIL: Create history entry to track healing decision
          await this.jobHistoryRepository.createEntry({
            jobId: job.id,
            eventType: JobEventType.AUTO_HEALED,
            stage: JobStage.FAILED, // Was in FAILED before healing
            progress: job.progress || 0,
            wasAutoHealed: true,
            tempFileExists: false,
            retryNumber: job.retryCount + 1,
            triggeredBy: 'BACKEND_RESTART',
            systemMessage: `Auto-healed: restarting encode from 0% (was at ${(job.progress || 0).toFixed(1)}%)`,
          });

          healedCount++;
        } catch (error: unknown) {
          this.logger.error(`Failed to heal job ${job.id} (${job.fileLabel})`, error);
        }
      }

      this.logger.log(`Auto-healing complete: ${healedCount} job(s) re-queued for retry`);

      return healedCount;
    } catch (error: unknown) {
      this.logger.error('Failed to heal failed jobs', error);
      return 0;
    }
  }
}
