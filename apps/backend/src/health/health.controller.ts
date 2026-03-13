import { version as APP_VERSION } from '@bitbonsai/version';
import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/guards/public.decorator';
import type { BasicHealthDto } from './dto/basic-health.dto';
import type { DetailedHealthDto } from './dto/detailed-health.dto';
import type { DiskSpaceMonitoringDto } from './dto/disk-space-monitoring.dto';
import type { LivenessDto } from './dto/liveness.dto';
import type { ReadinessDto } from './dto/readiness.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Basic health check',
    description: 'Returns basic health status including uptime and version',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2025-10-01T12:00:00Z',
        uptime: 3600,
        version: APP_VERSION, // Read from package.json
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Application has issues but is responding',
    schema: {
      example: {
        status: 'error',
        timestamp: '2025-10-01T12:00:00Z',
        uptime: 3600,
        version: APP_VERSION, // Read from package.json
      },
    },
  })
  async getHealth(): Promise<BasicHealthDto> {
    return this.healthService.getBasicHealth();
  }

  @Get('detailed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Detailed health check',
    description:
      'Returns comprehensive health status including all service checks, node status, and queue metrics',
  })
  @ApiResponse({
    status: 200,
    description: 'Detailed health information',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2025-10-01T12:00:00Z',
        checks: {
          database: { status: 'ok', responseTime: 15 },
          redis: { status: 'unavailable' },
          disk: { status: 'ok', used: '50%', available: '500GB' },
          memory: {
            status: 'ok',
            used: '2GB',
            total: '16GB',
            percentage: 12.5,
          },
          ffmpeg: { status: 'ok', responseTime: 50, version: '5.1.2' },
        },
        nodes: {
          total: 2,
          online: 2,
          offline: 0,
        },
        queue: {
          queued: 5,
          encoding: 2,
          completed: 150,
          failed: 3,
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Application has degraded performance',
    schema: {
      example: {
        status: 'degraded',
        timestamp: '2025-10-01T12:00:00Z',
        checks: {
          database: { status: 'ok', responseTime: 15 },
          redis: { status: 'error', error: 'Connection refused' },
          disk: { status: 'warning', used: '85%', available: '150GB' },
          memory: {
            status: 'ok',
            used: '2GB',
            total: '16GB',
            percentage: 12.5,
          },
          ffmpeg: { status: 'ok', responseTime: 50, version: '5.1.2' },
        },
        nodes: {
          total: 2,
          online: 1,
          offline: 1,
        },
        queue: {
          queued: 5,
          encoding: 2,
          completed: 150,
          failed: 3,
        },
      },
    },
  })
  async getDetailedHealth(): Promise<DetailedHealthDto> {
    return this.healthService.getDetailedHealth();
  }

  @Get('disk-space')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Disk space monitoring',
    description:
      'Monitor disk space across all libraries with predictive warnings for queued jobs. ' +
      'Provides per-library breakdown, cross-filesystem awareness, and estimates space needed for queue.',
  })
  @ApiResponse({
    status: 200,
    description: 'Disk space monitoring data for all libraries',
    schema: {
      example: {
        overallStatus: 'ok',
        timestamp: '2025-10-01T12:00:00Z',
        libraries: [
          {
            libraryId: 'lib-123',
            libraryName: 'Movies',
            path: '/mnt/user/movies',
            status: 'ok',
            totalBytes: '1000000000000',
            availableBytes: '500000000000',
            usedBytes: '500000000000',
            usedPercent: 50,
            availableFormatted: '500 GB',
            totalFormatted: '1 TB',
            queuedJobsCount: 10,
            estimatedSpaceNeededBytes: '100000000000',
            hasEnoughSpaceForQueue: true,
            warningMessage: null,
          },
        ],
        globalWarnings: [],
        totalQueuedJobs: 10,
        totalEstimatedSpaceNeeded: '100000000000',
        canAccommodateQueue: true,
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Disk space warning detected',
    schema: {
      example: {
        overallStatus: 'warning',
        timestamp: '2025-10-01T12:00:00Z',
        libraries: [
          {
            libraryId: 'lib-123',
            libraryName: 'Movies',
            path: '/mnt/user/movies',
            status: 'warning',
            totalBytes: '1000000000000',
            availableBytes: '100000000000',
            usedBytes: '900000000000',
            usedPercent: 90,
            availableFormatted: '100 GB',
            totalFormatted: '1 TB',
            queuedJobsCount: 20,
            estimatedSpaceNeededBytes: '150000000000',
            hasEnoughSpaceForQueue: false,
            warningMessage: 'Insufficient space: need 50.0 GB more to complete 20 queued jobs',
          },
        ],
        globalWarnings: [
          'Library "Movies": Insufficient space: need 50.0 GB more to complete 20 queued jobs',
        ],
        totalQueuedJobs: 20,
        totalEstimatedSpaceNeeded: '150000000000',
        canAccommodateQueue: false,
      },
    },
  })
  async getDiskSpaceMonitoring(): Promise<DiskSpaceMonitoringDto> {
    return this.healthService.monitorLibraryDiskSpace();
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Readiness probe',
    description: 'Kubernetes readiness probe - checks if application is ready to accept requests',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is ready',
    schema: {
      example: {
        ready: true,
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Application is not ready',
    schema: {
      example: {
        ready: false,
        reason: 'Database connection failed',
      },
    },
  })
  async getReadiness(): Promise<ReadinessDto> {
    const result = await this.healthService.isReady();

    if (!result.ready) {
      throw new ServiceUnavailableException(result);
    }

    return result;
  }

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Kubernetes liveness probe - checks if application is alive and should be restarted if not',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is alive',
    schema: {
      example: {
        alive: true,
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Application is not alive',
    schema: {
      example: {
        alive: false,
      },
    },
  })
  async getLiveness(): Promise<LivenessDto> {
    const result = await this.healthService.isLive();

    if (!result.alive) {
      throw new ServiceUnavailableException(result);
    }

    return result;
  }

  @Get('ping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Simple ping endpoint',
    description: 'Ultra-simple health check that returns "Ok" as text/plain for monitoring tools',
  })
  @ApiResponse({
    status: 200,
    description: 'Server is responding',
    content: {
      'text/plain': {
        schema: {
          type: 'string',
          example: 'Ok',
        },
      },
    },
  })
  async ping(): Promise<string> {
    return 'Ok';
  }
}
