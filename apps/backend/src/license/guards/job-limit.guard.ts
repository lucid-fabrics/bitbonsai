import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { LicenseClientService } from '../license-client.service';

@Injectable()
export class JobLimitGuard implements CanActivate {
  constructor(
    private readonly licenseClient: LicenseClientService,
    private readonly jobRepository: JobRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { maxConcurrentJobs } = await this.licenseClient.getCurrentLimits();

    const currentEncodingJobCount = await this.jobRepository.countWhere({
      stage: JobStage.ENCODING,
    });

    if (currentEncodingJobCount >= maxConcurrentJobs) {
      throw new ForbiddenException(
        `Concurrent job limit reached (${currentEncodingJobCount}/${maxConcurrentJobs}). Upgrade your license for higher concurrency.`
      );
    }

    return true;
  }
}
