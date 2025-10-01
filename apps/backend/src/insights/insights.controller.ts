import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Metric } from '@prisma/client';
import { CodecDistributionDto } from './dto/codec-distribution.dto';
import { InsightsStatsDto } from './dto/insights-stats.dto';
import { NodeComparisonDto } from './dto/node-comparison.dto';
import { SavingsTrendDto } from './dto/savings-trend.dto';
import type { TimeSeriesQueryDto } from './dto/time-series-query.dto';
import type { InsightsService } from './insights.service';

@ApiTags('insights')
@Controller('insights')
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  /**
   * Get time-series metrics with optional filters
   */
  @Get('metrics')
  @ApiOperation({
    summary: 'Get time-series metrics',
    description:
      'Retrieves time-series metrics for analytics dashboard with optional filters.\n\n' +
      '**Features**:\n' +
      '- **Date Range**: Filter metrics by start and end date\n' +
      '- **Node Filter**: View metrics for a specific encoding node\n' +
      '- **License Filter**: View metrics for a specific license\n' +
      '- **Time Series**: Returns ordered data points for trend visualization\n\n' +
      '**Use Case**: Chart data for jobs completed, bytes saved, throughput over time\n\n' +
      '**Example Chart**: Line chart showing daily encoding performance',
  })
  @ApiQuery({
    name: 'startDate',
    description: 'Start date for time range (ISO 8601)',
    example: '2024-01-01T00:00:00Z',
    required: true,
    type: String,
  })
  @ApiQuery({
    name: 'endDate',
    description: 'End date for time range (ISO 8601)',
    example: '2024-12-31T23:59:59Z',
    required: true,
    type: String,
  })
  @ApiQuery({
    name: 'nodeId',
    description: 'Optional node ID to filter metrics',
    example: 'clq8x9z8x0002qh8x9z8x0002',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'licenseId',
    description: 'Optional license ID to filter metrics',
    example: 'clq8x9z8x0001qh8x9z8x0001',
    required: false,
    type: String,
  })
  @ApiOkResponse({
    description: 'Time-series metrics retrieved successfully',
    type: [Object],
    schema: {
      example: [
        {
          id: 'clq8x9z8x0003qh8x9z8x0003',
          date: '2024-09-30T00:00:00.000Z',
          nodeId: 'clq8x9z8x0002qh8x9z8x0002',
          licenseId: 'clq8x9z8x0001qh8x9z8x0001',
          jobsCompleted: 42,
          jobsFailed: 1,
          totalSavedBytes: '5368709120',
          avgThroughputFilesPerHour: 12.5,
          codecDistribution: { 'H.264': 25, HEVC: 15, AV1: 2 },
          createdAt: '2024-09-30T23:59:59.999Z',
        },
      ],
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching metrics',
  })
  async getMetrics(@Query() query: TimeSeriesQueryDto): Promise<Metric[]> {
    return this.insightsService.getTimeSeriesMetrics({
      startDate: new Date(query.startDate),
      endDate: new Date(query.endDate),
      nodeId: query.nodeId,
      licenseId: query.licenseId,
    });
  }

  /**
   * Get aggregated statistics
   */
  @Get('stats')
  @ApiOperation({
    summary: 'Get aggregated statistics',
    description:
      'Returns high-level aggregated statistics across all jobs and nodes.\n\n' +
      '**Metrics Included**:\n' +
      '- **Jobs**: Total completed and failed jobs\n' +
      '- **Savings**: Total bytes and GB saved\n' +
      '- **Throughput**: Average encoding speed across all nodes\n' +
      '- **Success Rate**: Percentage of successfully completed jobs\n\n' +
      '**Use Case**: Dashboard KPI cards, overview statistics\n\n' +
      '**Example Display**:\n' +
      '```\n' +
      '┌─────────────────────────────────┐\n' +
      '│ Total Jobs: 1,247               │\n' +
      '│ Space Saved: 488.28 GB          │\n' +
      '│ Success Rate: 98.2%             │\n' +
      '│ Avg Throughput: 12.5 files/hr   │\n' +
      '└─────────────────────────────────┘\n' +
      '```',
  })
  @ApiQuery({
    name: 'licenseId',
    description: 'Optional license ID to filter statistics',
    example: 'clq8x9z8x0001qh8x9z8x0001',
    required: false,
    type: String,
  })
  @ApiOkResponse({
    description: 'Aggregated statistics retrieved successfully',
    type: InsightsStatsDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while calculating statistics',
  })
  async getStats(@Query('licenseId') licenseId?: string): Promise<InsightsStatsDto> {
    return this.insightsService.getAggregatedStats(licenseId);
  }

  /**
   * Get codec distribution
   */
  @Get('codecs')
  @ApiOperation({
    summary: 'Get codec distribution',
    description:
      'Returns the distribution of video codecs across all processed files.\n\n' +
      '**Data Structure**:\n' +
      '- **Per-Codec Stats**: Count and percentage for each codec\n' +
      '- **Total Files**: Overall file count for context\n' +
      '- **Sorted**: Results ordered by usage (most common first)\n\n' +
      '**Use Case**: Pie chart or bar chart showing codec usage\n\n' +
      '**Example Chart**:\n' +
      '```\n' +
      'Codec Distribution\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      'H.264  ████████████████████ 59.4%\n' +
      'HEVC   ███████████ 34.2%\n' +
      'AV1    ██ 5.3%\n' +
      'VP9    ▌ 1.1%\n' +
      '```',
  })
  @ApiQuery({
    name: 'licenseId',
    description: 'Optional license ID to filter codec distribution',
    example: 'clq8x9z8x0001qh8x9z8x0001',
    required: false,
    type: String,
  })
  @ApiOkResponse({
    description: 'Codec distribution retrieved successfully',
    type: CodecDistributionDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while calculating codec distribution',
  })
  async getCodecDistribution(
    @Query('licenseId') licenseId?: string
  ): Promise<CodecDistributionDto> {
    return this.insightsService.getCodecDistribution(licenseId);
  }

  /**
   * Get savings trend
   */
  @Get('savings')
  @ApiOperation({
    summary: 'Get savings trend over time',
    description:
      'Returns daily savings data for trend visualization over a specified period.\n\n' +
      '**Time Periods**:\n' +
      '- **7 days**: Last week performance\n' +
      '- **30 days**: Monthly overview (default)\n' +
      '- **90 days**: Quarterly analysis\n' +
      '- **Custom**: Any number of days (1-365)\n\n' +
      '**Data Points**:\n' +
      '- **Daily Savings**: Bytes saved each day\n' +
      '- **Job Count**: Number of jobs completed per day\n' +
      '- **Cumulative Total**: Overall savings for the period\n\n' +
      '**Use Case**: Area chart or line chart showing savings growth\n\n' +
      '**Example Chart**:\n' +
      '```\n' +
      'Space Savings Trend (Last 30 Days)\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      '10 GB ┤     ╭─╮\n' +
      ' 8 GB ┤   ╭─╯ ╰╮\n' +
      ' 6 GB ┤  ╭╯    ╰─╮  ╭─╮\n' +
      ' 4 GB ┤╭─╯       ╰──╯ ╰─╮\n' +
      ' 2 GB ┼╯              ╰──\n' +
      '      └──────────────────\n' +
      'Total: 100 GB saved\n' +
      '```',
  })
  @ApiQuery({
    name: 'days',
    description: 'Number of days to retrieve (default: 30)',
    example: 30,
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'licenseId',
    description: 'Optional license ID to filter savings trend',
    example: 'clq8x9z8x0001qh8x9z8x0001',
    required: false,
    type: String,
  })
  @ApiOkResponse({
    description: 'Savings trend retrieved successfully',
    type: SavingsTrendDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while calculating savings trend',
  })
  async getSavingsTrend(
    @Query('days') days = 30,
    @Query('licenseId') licenseId?: string
  ): Promise<SavingsTrendDto> {
    const numDays = Number(days);
    return this.insightsService.getSavingsTrend(numDays, licenseId);
  }

  /**
   * Get node performance comparison
   */
  @Get('nodes')
  @ApiOperation({
    summary: 'Compare performance across nodes',
    description:
      'Returns performance metrics for all nodes to compare efficiency.\n\n' +
      '**Comparison Metrics**:\n' +
      '- **Jobs**: Completed vs failed count\n' +
      '- **Success Rate**: Reliability percentage\n' +
      '- **Savings**: Total bytes saved per node\n' +
      '- **Throughput**: Average encoding speed\n' +
      '- **Acceleration**: Hardware acceleration type\n' +
      '- **Status**: Current node availability\n\n' +
      '**Use Case**: Node management, performance optimization, hardware comparison\n\n' +
      '**Example Table**:\n' +
      '```\n' +
      '┌─────────────────────┬──────────┬─────────┬──────────┬────────────┐\n' +
      '│ Node                │ Jobs     │ Success │ Saved GB │ Throughput │\n' +
      '├─────────────────────┼──────────┼─────────┼──────────┼────────────┤\n' +
      '│ Main (NVIDIA)       │ 523      │ 98.7%   │ 250.0    │ 15.3/hr    │\n' +
      '│ Secondary (QSV)     │ 412      │ 97.8%   │ 188.3    │ 11.2/hr    │\n' +
      '│ Backup (CPU)        │ 312      │ 96.5%   │ 50.0     │ 5.8/hr     │\n' +
      '└─────────────────────┴──────────┴─────────┴──────────┴────────────┘\n' +
      '```',
  })
  @ApiQuery({
    name: 'licenseId',
    description: 'Optional license ID to filter node comparison',
    example: 'clq8x9z8x0001qh8x9z8x0001',
    required: false,
    type: String,
  })
  @ApiOkResponse({
    description: 'Node comparison retrieved successfully',
    type: NodeComparisonDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while comparing nodes',
  })
  async getNodeComparison(@Query('licenseId') licenseId?: string): Promise<NodeComparisonDto> {
    return this.insightsService.getNodeComparison(licenseId);
  }
}
