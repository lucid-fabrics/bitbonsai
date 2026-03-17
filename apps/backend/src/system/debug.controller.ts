import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DebugService } from './debug.service';

/**
 * DebugController
 *
 * Debug endpoints for system monitoring and troubleshooting.
 * Delegates all logic to DebugService.
 *
 * Features:
 * - System load monitoring (CPU, memory, load average)
 * - FFmpeg process tracking and zombie detection
 * - Load threshold management
 */
@ApiTags('Debug')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('debug')
export class DebugController {
  constructor(private readonly debugService: DebugService) {}

  /**
   * Get current system load information
   */
  @Get('system-load')
  @ApiOperation({
    summary: 'Get system load information',
    description:
      'Returns current CPU load average, memory usage, load threshold settings, and throttling status.',
  })
  @ApiOkResponse({ description: 'System load information' })
  @ApiInternalServerErrorResponse({ description: 'Failed to get system load' })
  async getSystemLoad() {
    return this.debugService.getSystemLoad();
  }

  /**
   * List all FFmpeg processes (system-wide)
   */
  @Get('ffmpeg-processes')
  @ApiOperation({
    summary: 'List FFmpeg processes',
    description: 'Returns all FFmpeg processes running on the system with zombie detection.',
  })
  @ApiOkResponse({ description: 'List of FFmpeg processes' })
  @ApiInternalServerErrorResponse({ description: 'Failed to list processes' })
  async getFfmpegProcesses() {
    return this.debugService.getFfmpegProcesses();
  }

  /**
   * Kill a specific FFmpeg process by PID
   */
  @Delete('ffmpeg-processes/:pid')
  @ApiOperation({
    summary: 'Kill FFmpeg process by PID',
    description: 'Kills a specific FFmpeg process by its PID.',
  })
  @ApiParam({ name: 'pid', type: 'number', description: 'Process ID to kill' })
  @ApiOkResponse({ description: 'Process killed' })
  @ApiNotFoundResponse({ description: 'Process not found' })
  async killFfmpegProcess(@Param('pid', ParseIntPipe) pid: number) {
    return this.debugService.killProcessByPid(pid);
  }

  /**
   * Kill all zombie FFmpeg processes
   */
  @Delete('ffmpeg-processes/zombies')
  @ApiOperation({
    summary: 'Kill all zombie FFmpeg processes',
    description: 'Finds and kills all FFmpeg processes running on the system.',
  })
  @ApiOkResponse({ description: 'Zombie processes killed' })
  @ApiInternalServerErrorResponse({ description: 'Failed to kill processes' })
  async killAllZombies() {
    return this.debugService.killAllZombies();
  }

  /**
   * Update load threshold multiplier for current node
   */
  @Post('load-threshold')
  @ApiOperation({
    summary: 'Update load threshold multiplier',
    description:
      'Updates the load threshold multiplier for the current node. ' +
      'Higher values = more tolerant of high load (useful for NAS systems).',
  })
  @ApiOkResponse({ description: 'Load threshold updated' })
  @ApiInternalServerErrorResponse({ description: 'Failed to update threshold' })
  async updateLoadThreshold(@Body() body: { loadThresholdMultiplier: number }) {
    return this.debugService.updateLoadThreshold(body.loadThresholdMultiplier);
  }
}
