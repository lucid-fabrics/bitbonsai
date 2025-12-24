import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '../security/admin-api-key.guard';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller('analytics')
@UseGuards(AdminApiKeyGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('revenue-metrics')
  @ApiOperation({
    summary: 'Get revenue metrics',
    description: 'Returns MRR, ARR, churn rate, CLV, and subscription health metrics',
  })
  @ApiResponse({
    status: 200,
    description: 'Revenue metrics retrieved successfully',
  })
  async getRevenueMetrics() {
    return this.analyticsService.getRevenueMetrics();
  }

  @Get('daily-revenue')
  @ApiOperation({
    summary: 'Get daily revenue',
    description: 'Returns daily revenue and subscription counts for charting',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: 'Number of days to retrieve (default: 30)',
    example: 30,
  })
  @ApiResponse({
    status: 200,
    description: 'Daily revenue data retrieved successfully',
  })
  async getDailyRevenue(@Query('days') days?: string) {
    const daysNum = days ? parseInt(days, 10) : 30;
    return this.analyticsService.getDailyRevenue(daysNum);
  }

  @Get('tier-distribution')
  @ApiOperation({
    summary: 'Get tier distribution',
    description: 'Returns active subscription distribution across tiers',
  })
  @ApiResponse({
    status: 200,
    description: 'Tier distribution retrieved successfully',
  })
  async getTierDistribution() {
    return this.analyticsService.getTierDistribution();
  }

  @Get('monthly-churn')
  @ApiOperation({
    summary: 'Get monthly churn rate',
    description: 'Returns churn rate history for the specified number of months',
  })
  @ApiQuery({
    name: 'months',
    required: false,
    description: 'Number of months to retrieve (default: 12)',
    example: 12,
  })
  @ApiResponse({
    status: 200,
    description: 'Monthly churn data retrieved successfully',
  })
  async getMonthlyChurnRate(@Query('months') months?: string) {
    const monthsNum = months ? parseInt(months, 10) : 12;
    return this.analyticsService.getMonthlyChurnRate(monthsNum);
  }
}
