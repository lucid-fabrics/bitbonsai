import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LicenseClientService } from '../license-client.service';

@Injectable()
export class JobLimitGuard implements CanActivate {
  constructor(
    private readonly licenseClient: LicenseClientService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { maxConcurrentJobs } = await this.licenseClient.getCurrentLimits();

    const currentEncodingJobCount = await this.prisma.job.count({
      where: {
        status: 'ENCODING',
      },
    });

    if (currentEncodingJobCount >= maxConcurrentJobs) {
      throw new ForbiddenException(
        `Concurrent job limit reached (${currentEncodingJobCount}/${maxConcurrentJobs}). Upgrade your license for higher concurrency.`
      );
    }

    return true;
  }
}
