import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HealthDashboardService, type SystemDashboard } from './health-dashboard.service';

@ApiTags('system')
@Controller('system/dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(private readonly dashboardService: HealthDashboardService) {}

  /**
   * Get comprehensive system dashboard
   */
  @Get()
  @ApiOperation({
    summary: 'Get system dashboard',
    description:
      'Returns comprehensive system health information including:\n' +
      '- Health checks (CPU, memory, database, queue)\n' +
      '- System metrics (load, memory, uptime)\n' +
      '- Queue statistics (jobs by stage, throughput)\n' +
      '- Storage statistics (disk usage)\n' +
      '- Node status (online/offline counts)\n' +
      '- Encoding metrics (processed, saved, failure rate)\n' +
      '- Hardware information (GPU, CPU)',
  })
  @ApiOkResponse({
    description: 'System dashboard data',
    schema: {
      type: 'object',
      properties: {
        timestamp: { type: 'string', format: 'date-time' },
        overallStatus: {
          type: 'string',
          enum: ['HEALTHY', 'WARNING', 'CRITICAL', 'UNKNOWN'],
        },
        checks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              status: { type: 'string' },
              message: { type: 'string' },
              value: { type: 'number' },
              threshold: { type: 'number' },
            },
          },
        },
        system: {
          type: 'object',
          properties: {
            platform: { type: 'string' },
            hostname: { type: 'string' },
            uptime: { type: 'number' },
            loadAverage: { type: 'array', items: { type: 'number' } },
            cpuUsage: { type: 'number' },
            memoryUsed: { type: 'number' },
            memoryTotal: { type: 'number' },
            memoryPercent: { type: 'number' },
          },
        },
        queue: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            byStage: { type: 'object' },
            activeWorkers: { type: 'number' },
            avgProcessingTimeMs: { type: 'number' },
            avgWaitTimeMs: { type: 'number' },
            throughputPerHour: { type: 'number' },
          },
        },
        storage: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              totalBytes: { type: 'number' },
              freeBytes: { type: 'number' },
              usedBytes: { type: 'number' },
              usedPercent: { type: 'number' },
            },
          },
        },
        nodes: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            online: { type: 'number' },
            offline: { type: 'number' },
            byRole: { type: 'object' },
          },
        },
        encoding: {
          type: 'object',
          properties: {
            totalProcessed: { type: 'number' },
            totalSavedBytes: { type: 'string' },
            avgSavedPercent: { type: 'number' },
            failureRate: { type: 'number' },
            last24hCompleted: { type: 'number' },
            last24hFailed: { type: 'number' },
          },
        },
        hardware: {
          type: 'object',
          properties: {
            accelerationType: { type: 'string' },
            cpuCores: { type: 'number' },
            cpuModel: { type: 'string' },
            gpuDetected: { type: 'boolean' },
            gpuModel: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiInternalServerErrorResponse({ description: 'Failed to build dashboard' })
  async getDashboard(): Promise<SystemDashboard> {
    this.logger.debug('Dashboard data requested');
    return this.dashboardService.getDashboard();
  }

  /**
   * Get health checks only
   */
  @Get('health')
  @ApiOperation({
    summary: 'Get health checks',
    description: 'Returns only health check results without full dashboard data.',
  })
  @ApiOkResponse({ description: 'Health check results' })
  @ApiInternalServerErrorResponse({ description: 'Failed to run health checks' })
  async getHealthChecks() {
    return this.dashboardService.runHealthChecks();
  }
}
