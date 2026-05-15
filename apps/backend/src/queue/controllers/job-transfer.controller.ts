import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { QueueService } from '../queue.service';
import { FileTransferService } from '../services/file-transfer.service';

@ApiTags('queue')
@Controller('queue')
export class JobTransferController {
  constructor(
    private readonly queueService: QueueService,
    private readonly fileTransferService: FileTransferService
  ) {}

  /**
   * Get active file transfers (jobs in TRANSFERRING stage)
   */
  @Get('transfers/active')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get active file transfers',
    description:
      'Returns all jobs currently transferring files to LINKED nodes without shared storage.\n\n' +
      '**Use Cases**:\n' +
      '- Monitor active file transfers in overview page\n' +
      '- Display transfer progress and speed\n' +
      '- Show ETA for transfers',
  })
  @ApiOkResponse({
    description: 'List of jobs in TRANSFERRING stage (paginated)',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  async getActiveTransfers(): Promise<unknown> {
    return this.queueService.findAll('TRANSFERRING');
  }

  /**
   * Get transfer progress for a specific job
   */
  @Get(':id/transfer/progress')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get transfer progress for a job',
    description:
      'Returns detailed transfer progress including speed, bytes transferred, and ETA.\n\n' +
      '**Response Fields**:\n' +
      '- progress: 0-100%\n' +
      '- speedMBps: Current transfer speed in MB/s\n' +
      '- bytesTransferred: Bytes transferred so far\n' +
      '- totalBytes: Total file size\n' +
      '- eta: Estimated time to completion (seconds)\n' +
      '- status: PENDING, TRANSFERRING, COMPLETED, FAILED',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Transfer progress details',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  async getTransferProgress(@Param('id') id: string): Promise<unknown> {
    return this.fileTransferService.getTransferProgress(id);
  }

  /**
   * Cancel ongoing file transfer
   */
  @Post(':id/transfer/cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel ongoing file transfer',
    description:
      'Cancels an active file transfer and marks the job as CANCELLED.\n\n' +
      '**Behavior**:\n' +
      '- Aborts rsync process\n' +
      '- Sets job stage to CANCELLED\n' +
      '- Cleans up partial transfer files',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Transfer cancelled successfully',
  })
  @ApiNotFoundResponse({
    description: 'Job not found or no active transfer',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  async cancelTransfer(@Param('id') id: string): Promise<void> {
    return this.fileTransferService.cancelTransfer(id);
  }
}
