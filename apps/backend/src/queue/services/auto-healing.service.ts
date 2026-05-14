import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobEventType, JobStage } from '@prisma/client';
import { existsSync } from 'fs';
import { JobRepository } from '../../common/repositories/job.repository';
import { JobHistoryRepository } from '../../common/repositories/job-history.repository';
import { SettingsRepository } from '../../common/repositories/settings.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { CircuitBreakerService } from './circuit-breaker.service';

/**
 * AutoHealingService
 *
 * Automatically recovers failed jobs on container restart.
 * Runs once during application startup to re-queue eligible failed jobs.
 *
 * Recovery Criteria:
 * - Job must be in FAILED stage
 * - retryCount must be < maxAutoHealRetries (configurable, default: 15)
 * - Respects nextRetryAt timestamp (exponential backoff)
 */
@Injectable()
export class AutoHealingService implements OnModuleInit {
  private readonly logger = new Logger(AutoHealingService.name);

  // PERF: Cache settings to avoid repeated DB queries
  private settingsCache: { maxRetries: number; cachedAt: number } | null = null;
  private readonly SETTINGS_CACHE_TTL_MS = 60000; // 1 minute cache

  constructor(
    private readonly jobHistoryRepository: JobHistoryRepository,
    private readonly jobRepository: JobRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly nodeConfig: NodeConfigService,
    private readonly circuitBreaker: CircuitBreakerService
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
   * - Not permanently failed
   *
   * @returns Number of jobs healed
   */
  async healFailedJobs(): Promise<number> {
    try {
      const now = new Date();

      // PERF: Get max retry limit with caching
      const maxRetries = await this.getMaxRetries();
      this.logger.log(`Auto-heal max retry limit: ${maxRetries}`);

      // PERF: Optimized query uses composite index (stage, retryCount, nextRetryAt)
      // Find eligible failed jobs — permanently broken jobs (circuitBroken) are excluded
      const eligibleJobs = await this.jobRepository.findManySelect<{
        id: string;
        fileLabel: string;
        retryCount: number;
        nextRetryAt: Date | null;
        progress: number;
        tempFilePath: string | null;
        resumeTimestamp: string | null;
      }>(
        {
          stage: JobStage.FAILED,
          circuitBroken: false,
          retryCount: { lt: maxRetries },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        {
          id: true,
          fileLabel: true,
          retryCount: true,
          nextRetryAt: true,
          progress: true,
          tempFilePath: true,
          resumeTimestamp: true,
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
          // HEAL UX: Check if temp file actually exists before deciding to resume or start fresh
          const hasTempFile = job.tempFilePath && existsSync(job.tempFilePath);
          const canResume = hasTempFile && job.resumeTimestamp;

          // Prepare healing data based on temp file availability
          let healingMessage: string;
          let systemMessage: string;

          if (canResume) {
            // Temp file exists - can resume from checkpoint
            healingMessage = `will resume from ${(job.progress || 0).toFixed(1)}%`;
            systemMessage = `Auto-healed: Will resume encoding from ${(job.progress || 0).toFixed(1)}% (temp file preserved)`;
            this.logger.log(
              `✅ Healed job: ${job.fileLabel} (retry ${job.retryCount + 1}/${maxRetries}, ${healingMessage})`
            );
          } else {
            // Temp file missing or invalid - must start fresh
            const reason = job.tempFilePath ? 'temp file deleted' : 'no temp file';
            healingMessage = `starting fresh (${reason})`;
            systemMessage = `Auto-healed: Temp file not available, starting encoding from scratch (was at ${(job.progress || 0).toFixed(1)}%)`;
            this.logger.log(
              `⚠️  Healed job: ${job.fileLabel} (retry ${job.retryCount + 1}/${maxRetries}, ${healingMessage})`
            );
          }

          // Circuit breaker: increment totalAttempts and permanently fail if threshold reached.
          // This ensures repeated auto-heal cycles don't loop forever on a persistently broken job.
          const broke = await this.circuitBreaker.checkAndBreak(job.id, 'auto-heal-retry');
          if (broke) {
            this.logger.warn(
              `Circuit breaker tripped for ${job.fileLabel} — permanently excluded after ${job.retryCount} auto-heal attempts`
            );
            continue;
          }

          // Update job with appropriate resume state
          await this.jobRepository.updateById(job.id, {
            stage: JobStage.QUEUED,
            progress: canResume ? job.progress : 0, // Keep progress if resuming
            error: null,
            completedAt: null,
            startedAt: null,
            retryCount: job.retryCount + 1,
            // AUTO-HEAL TRACKING: Record when job was auto-healed and where it resumed from
            autoHealedAt: new Date(),
            autoHealedProgress: job.progress || 0, // Always record original progress for history
            // HEAL UX: Only clear resume state if temp file doesn't exist
            resumeTimestamp: canResume ? job.resumeTimestamp : null,
            tempFilePath: canResume ? job.tempFilePath : null,
          });

          // AUDIT TRAIL: Create history entry to track healing decision
          await this.jobHistoryRepository.createEntry({
            jobId: job.id,
            eventType: JobEventType.AUTO_HEALED,
            stage: JobStage.FAILED, // Was in FAILED before healing
            progress: job.progress || 0,
            wasAutoHealed: true,
            tempFileExists: !!hasTempFile,
            retryNumber: job.retryCount + 1,
            triggeredBy: 'BACKEND_RESTART',
            systemMessage,
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
