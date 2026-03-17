import { Body, Controller, Delete, Get, Logger, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  type BatchOperationResult,
  BatchOperationsService,
} from './services/batch-operations.service';

/**
 * DTO for batch retry operation
 */
class BatchRetryDto {
  @ApiPropertyOptional({ description: 'Only retry jobs for this node' })
  @IsOptional()
  @IsString()
  nodeId?: string;

  @ApiPropertyOptional({ description: 'Maximum retry count threshold', default: 3 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxRetries?: number;
}

/**
 * DTO for batch delete operation
 */
class BatchDeleteDto {
  @ApiPropertyOptional({ description: 'Delete jobs older than this many days', default: 30 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  olderThanDays?: number;

  @ApiPropertyOptional({ description: 'Only delete jobs for this node' })
  @IsOptional()
  @IsString()
  nodeId?: string;
}

/**
 * DTO for clear all operation
 */
class ClearAllDto {
  @ApiProperty({
    description: 'Confirmation token - must be "CLEAR_ALL_JOBS" to proceed',
    example: 'CLEAR_ALL_JOBS',
  })
  @IsString()
  confirmationToken!: string;
}

@ApiTags('queue/batch')
@Controller('queue/batch')
@UseGuards(JwtAuthGuard)
export class BatchController {
  private readonly logger = new Logger(BatchController.name);

  constructor(private readonly batchOperations: BatchOperationsService) {}

  /**
   * Pause all active jobs
   */
  @Post('pause')
  @ApiOperation({
    summary: 'Pause all active jobs',
    description:
      'Pauses all jobs in QUEUED or ENCODING stage. Use nodeId parameter to pause only jobs for a specific node.',
  })
  @ApiQuery({
    name: 'nodeId',
    required: false,
    description: 'Only pause jobs for this node',
  })
  @ApiOkResponse({
    description: 'Jobs paused successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        affectedCount: { type: 'number' },
        errors: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to pause jobs',
  })
  async pauseAll(@Query('nodeId') nodeId?: string): Promise<BatchOperationResult> {
    this.logger.log(`Batch pause requested${nodeId ? ` for node ${nodeId}` : ''}`);
    return this.batchOperations.pauseAll(nodeId);
  }

  /**
   * Resume all paused jobs
   */
  @Post('resume')
  @ApiOperation({
    summary: 'Resume all paused jobs',
    description:
      'Resumes all jobs in PAUSED or PAUSED_LOAD stage. Use nodeId parameter to resume only jobs for a specific node.',
  })
  @ApiQuery({
    name: 'nodeId',
    required: false,
    description: 'Only resume jobs for this node',
  })
  @ApiOkResponse({
    description: 'Jobs resumed successfully',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to resume jobs',
  })
  async resumeAll(@Query('nodeId') nodeId?: string): Promise<BatchOperationResult> {
    this.logger.log(`Batch resume requested${nodeId ? ` for node ${nodeId}` : ''}`);
    return this.batchOperations.resumeAll(nodeId);
  }

  /**
   * Cancel all active jobs
   */
  @Post('cancel')
  @ApiOperation({
    summary: 'Cancel all active jobs',
    description:
      'Cancels all jobs in QUEUED, ENCODING, PAUSED, or HEALTH_CHECK stage. Use nodeId parameter to cancel only jobs for a specific node.',
  })
  @ApiQuery({
    name: 'nodeId',
    required: false,
    description: 'Only cancel jobs for this node',
  })
  @ApiOkResponse({
    description: 'Jobs cancelled successfully',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to cancel jobs',
  })
  async cancelAll(@Query('nodeId') nodeId?: string): Promise<BatchOperationResult> {
    this.logger.log(`Batch cancel requested${nodeId ? ` for node ${nodeId}` : ''}`);
    return this.batchOperations.cancelAll(nodeId);
  }

  /**
   * Retry all failed jobs
   */
  @Post('retry')
  @ApiOperation({
    summary: 'Retry all failed jobs',
    description:
      'Queues all failed jobs for retry. Only retries jobs with fewer retries than maxRetries threshold.',
  })
  @ApiOkResponse({
    description: 'Jobs queued for retry',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to retry jobs',
  })
  async retryAllFailed(@Body() dto: BatchRetryDto): Promise<BatchOperationResult> {
    this.logger.log(
      `Batch retry requested${dto.nodeId ? ` for node ${dto.nodeId}` : ''}, maxRetries: ${dto.maxRetries || 3}`
    );
    return this.batchOperations.retryAllFailed(dto.nodeId, dto.maxRetries);
  }

  /**
   * Delete old completed jobs
   */
  @Delete('completed')
  @ApiOperation({
    summary: 'Delete old completed jobs',
    description: 'Deletes completed jobs older than the specified number of days.',
  })
  @ApiOkResponse({
    description: 'Completed jobs deleted',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to delete completed jobs',
  })
  async deleteCompleted(@Body() dto: BatchDeleteDto): Promise<BatchOperationResult> {
    const days = dto.olderThanDays || 30;
    this.logger.log(
      `Batch delete completed jobs older than ${days} days${dto.nodeId ? ` for node ${dto.nodeId}` : ''}`
    );
    return this.batchOperations.deleteCompletedOlderThan(days, dto.nodeId);
  }

  /**
   * Delete all failed jobs
   */
  @Delete('failed')
  @ApiOperation({
    summary: 'Delete all failed jobs',
    description: 'Deletes all jobs in FAILED stage.',
  })
  @ApiQuery({
    name: 'nodeId',
    required: false,
    description: 'Only delete failed jobs for this node',
  })
  @ApiOkResponse({
    description: 'Failed jobs deleted',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to delete failed jobs',
  })
  async deleteFailed(@Query('nodeId') nodeId?: string): Promise<BatchOperationResult> {
    this.logger.log(`Batch delete failed jobs${nodeId ? ` for node ${nodeId}` : ''}`);
    return this.batchOperations.deleteAllFailed(nodeId);
  }

  /**
   * Get batch operation statistics
   */
  @Get('stats')
  @ApiOperation({
    summary: 'Get queue statistics',
    description: 'Returns job counts by stage for batch operation planning.',
  })
  @ApiQuery({
    name: 'nodeId',
    required: false,
    description: 'Only count jobs for this node',
  })
  @ApiOkResponse({
    description: 'Queue statistics',
    schema: {
      type: 'object',
      additionalProperties: { type: 'number' },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to retrieve queue stats',
  })
  async getStats(@Query('nodeId') nodeId?: string): Promise<Record<string, number>> {
    return this.batchOperations.getStats(nodeId);
  }

  /**
   * Clear entire queue (dangerous!)
   */
  @Delete('clear')
  @ApiOperation({
    summary: 'Clear entire queue',
    description:
      'DANGEROUS: Deletes ALL jobs from the queue. Requires confirmation token "CLEAR_ALL_JOBS".',
  })
  @ApiBadRequestResponse({
    description: 'Invalid confirmation token',
  })
  @ApiOkResponse({
    description: 'Queue cleared successfully',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to clear queue',
  })
  async clearAll(@Body() dto: ClearAllDto): Promise<BatchOperationResult> {
    this.logger.warn('Clear all jobs requested!');
    return this.batchOperations.clearAll(dto.confirmationToken);
  }
}
