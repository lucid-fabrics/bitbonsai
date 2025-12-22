import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AnalyticsService, TimePeriod } from './analytics.service';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('space-savings')
  @ApiOperation({ summary: 'Get space savings over time' })
  @ApiQuery({ name: 'period', enum: ['24h', '7d', '30d', '90d', 'all'], required: false })
  @ApiResponse({
    status: 200,
    description: 'Space savings statistics',
  })
  async getSpaceSavings(@Query('period') period?: TimePeriod) {
    return this.analyticsService.getSpaceSavingsOverTime(period || '30d');
  }

  @Get('encoding-speed')
  @ApiOperation({ summary: 'Get encoding speed trends' })
  @ApiQuery({ name: 'period', enum: ['24h', '7d', '30d', '90d', 'all'], required: false })
  @ApiResponse({
    status: 200,
    description: 'Encoding speed statistics by codec',
  })
  async getEncodingSpeed(@Query('period') period?: TimePeriod) {
    return this.analyticsService.getEncodingSpeedTrends(period || '30d');
  }

  @Get('cost-savings')
  @ApiOperation({ summary: 'Calculate storage cost savings' })
  @ApiQuery({ name: 'provider', required: false })
  @ApiResponse({
    status: 200,
    description: 'Cost savings by storage provider',
  })
  async getCostSavings(@Query('provider') provider?: string) {
    return this.analyticsService.getCostSavings(provider || 'AWS S3');
  }

  @Get('node-performance')
  @ApiOperation({ summary: 'Get node performance metrics' })
  @ApiQuery({ name: 'period', enum: ['24h', '7d', '30d', '90d', 'all'], required: false })
  @ApiResponse({
    status: 200,
    description: 'Performance metrics per node',
  })
  async getNodePerformance(@Query('period') period?: TimePeriod) {
    return this.analyticsService.getNodePerformance(period || '30d');
  }

  @Get('codec-performance')
  @ApiOperation({ summary: 'Get codec performance metrics' })
  @ApiQuery({ name: 'period', enum: ['24h', '7d', '30d', '90d', 'all'], required: false })
  @ApiResponse({
    status: 200,
    description: 'Performance metrics per codec',
  })
  async getCodecPerformance(@Query('period') period?: TimePeriod) {
    return this.analyticsService.getCodecPerformance(period || '30d');
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get analytics summary dashboard' })
  @ApiQuery({ name: 'period', enum: ['24h', '7d', '30d', '90d', 'all'], required: false })
  @ApiResponse({
    status: 200,
    description: 'Complete analytics summary',
  })
  async getSummary(@Query('period') period?: TimePeriod) {
    const [spaceSavings, encodingSpeed, costSavings, nodePerformance, codecPerformance] =
      await Promise.all([
        this.analyticsService.getSpaceSavingsOverTime(period || '30d'),
        this.analyticsService.getEncodingSpeedTrends(period || '30d'),
        this.analyticsService.getCostSavings('AWS S3'),
        this.analyticsService.getNodePerformance(period || '30d'),
        this.analyticsService.getCodecPerformance(period || '30d'),
      ]);

    return {
      period: period || '30d',
      spaceSavings,
      encodingSpeed,
      costSavings,
      nodePerformance,
      codecPerformance,
    };
  }
}
