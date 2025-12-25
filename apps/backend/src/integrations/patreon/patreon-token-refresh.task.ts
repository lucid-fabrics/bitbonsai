import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PatreonService } from './patreon.service';

/**
 * Patreon Token Refresh Task
 *
 * Automatically refreshes Patreon OAuth tokens for users with expiring tokens.
 * Runs daily at 2 AM to refresh tokens expiring within 7 days.
 *
 * Patreon tokens expire after 30 days, so this provides ample buffer.
 */
@Injectable()
export class PatreonTokenRefreshTask {
  private readonly logger = new Logger(PatreonTokenRefreshTask.name);

  constructor(private readonly patreonService: PatreonService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleTokenRefresh(): Promise<void> {
    if (!this.patreonService.isConfigured()) {
      this.logger.debug('Patreon not configured, skipping token refresh');
      return;
    }

    this.logger.log('Starting Patreon token refresh task');

    try {
      const result = await this.patreonService.refreshExpiringTokens();
      this.logger.log(
        `Patreon token refresh complete: ${result.refreshed} refreshed, ${result.failed} failed`
      );

      if (result.failed > 0) {
        this.logger.warn(
          `${result.failed} users failed token refresh - they may need to reconnect Patreon`
        );
      }
    } catch (error) {
      this.logger.error('Patreon token refresh task failed', error);
    }
  }
}
