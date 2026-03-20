import { Module } from '@nestjs/common';
import { MetricsRepository } from '../common/repositories/metrics.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

/**
 * Module for analytics and insights endpoints
 * Provides time-series metrics, aggregated statistics, and performance comparisons
 */
@Module({
  imports: [PrismaModule],
  controllers: [InsightsController],
  providers: [InsightsService, MetricsRepository, NodeRepository],
  exports: [InsightsService],
})
export class InsightsModule {}
