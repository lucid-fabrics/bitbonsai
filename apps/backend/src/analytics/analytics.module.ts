import { Module } from '@nestjs/common';
import { JobRepository } from '../common/repositories/job.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, JobRepository],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
