import { Module } from '@nestjs/common';
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
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}
