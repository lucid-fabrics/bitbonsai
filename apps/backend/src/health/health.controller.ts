import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type {
  BasicHealthDto,
  DetailedHealthDto,
  LivenessDto,
  ReadinessDto,
} from './dto/health-check.dto';
import type { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
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
        version: '0.1.0',
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
        version: '0.1.0',
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
}
