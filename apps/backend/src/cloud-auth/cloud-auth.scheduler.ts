import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CloudAuthService } from './cloud-auth.service';

@Injectable()
export class CloudAuthScheduler {
  private readonly logger = new Logger(CloudAuthScheduler.name);

  constructor(private readonly cloudAuthService: CloudAuthService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async revalidateEntitlements() {
    const ok = await this.cloudAuthService.validateNow();
    if (ok) {
      this.logger.debug('Entitlements revalidated');
    }
  }
}
