import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SystemService } from './system.service';

@ApiTags('system')
@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('resources')
  @ApiOperation({
    summary: 'Get system resource usage and worker capacity',
    description:
      'Returns CPU, memory, and optimal worker configuration based on hardware. ' +
      'Includes scenarios for different safety margins (conservative, balanced, aggressive).',
  })
  @ApiResponse({
    status: 200,
    description: 'System resources and worker capacity calculations',
    schema: {
      type: 'object',
      properties: {
        cpu: {
          type: 'object',
          properties: {
            model: { type: 'string', example: 'Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz' },
            cores: { type: 'number', example: 16 },
            coresPerJob: { type: 'number', example: 4 },
            theoreticalMaxWorkers: { type: 'number', example: 4 },
            safetyMargin: { type: 'number', example: 0.5 },
            configuredWorkers: { type: 'number', example: 2 },
            minWorkers: { type: 'number', example: 2 },
            maxWorkers: { type: 'number', example: 12 },
          },
        },
        memory: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 34359738368 },
            free: { type: 'number', example: 8589934592 },
            used: { type: 'number', example: 25769803776 },
            usedPercent: { type: 'number', example: 75.0 },
          },
        },
        scenarios: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              margin: { type: 'number', example: 0.5 },
              label: { type: 'string', example: 'Balanced (50%)' },
              workers: { type: 'number', example: 2 },
              risk: { type: 'string', enum: ['low', 'medium', 'high'] },
              description: { type: 'string' },
            },
          },
        },
        recommendation: {
          type: 'object',
          properties: {
            current: { type: 'string', example: 'balanced' },
            reason: { type: 'string' },
          },
        },
      },
    },
  })
  getSystemResources() {
    return this.systemService.getSystemResources();
  }
}
