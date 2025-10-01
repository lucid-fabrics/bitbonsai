import { Controller, Get } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OverviewStatsDto } from './dto/overview-stats.dto';
import type { OverviewService } from './overview.service';

/**
 * OverviewController
 *
 * Provides the main dashboard endpoint with aggregated system metrics.
 * Returns all key statistics in a single optimized API call.
 */
@ApiTags('overview')
@Controller('overview')
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  /**
   * Get complete overview statistics for the dashboard
   *
   * This endpoint provides all key metrics needed for the BitBonsai dashboard
   * in a single optimized API call. It aggregates:
   *
   * - **System Health**: Node status, storage capacity and utilization
   * - **Queue Statistics**: Job counts by stage (queued, encoding, completed, failed)
   * - **Recent Activity**: Last 10 completed jobs with savings details
   * - **Top Libraries**: Top 5 libraries by job count with performance metrics
   *
   * All queries are executed in parallel using Promise.all for optimal performance.
   */
  @Get()
  @ApiOperation({
    summary: 'Get dashboard overview statistics',
    description:
      'Returns aggregated metrics for the BitBonsai dashboard in a single optimized API call.\n\n' +
      '**Included Metrics**:\n' +
      '- **System Health**: Node status (active/offline), storage capacity and usage\n' +
      '- **Queue Statistics**: Job counts by stage, total savings across completed jobs\n' +
      '- **Recent Activity**: Last 10 completed jobs with codec info and savings\n' +
      '- **Top Libraries**: Top 5 libraries by job count with performance data\n\n' +
      '**Performance**:\n' +
      '- All data fetched via parallel queries using Prisma aggregations\n' +
      '- Optimized for dashboard real-time updates\n' +
      '- Single API call reduces network overhead\n\n' +
      '**Use Case**: Main dashboard page, system monitoring, executive summary',
  })
  @ApiOkResponse({
    description: 'Overview statistics retrieved successfully',
    type: OverviewStatsDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching overview statistics',
  })
  async getOverview(): Promise<OverviewStatsDto> {
    return this.overviewService.getOverviewStats();
  }
}
