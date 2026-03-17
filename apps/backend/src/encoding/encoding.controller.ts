import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { EncodingProcessorService } from './encoding-processor.service';

@ApiTags('encoding')
@Controller('encoding')
export class EncodingController {
  constructor(private readonly encodingService: EncodingProcessorService) {}

  /**
   * Start encoding worker for a node
   */
  @Post('workers/:nodeId/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start encoding worker pool for a node',
    description:
      'Starts multiple encoding workers for the specified node.\n\n' +
      '**Behavior**:\n' +
      '- Starts 4 concurrent workers by default (configurable up to 12)\n' +
      '- Each worker independently polls for new jobs\n' +
      '- Automatically processes queued jobs using FFmpeg\n' +
      '- Reports progress and updates job status\n' +
      '- Handles retries (max 3 attempts per job)\n' +
      '- Uses atomic job locking to prevent duplicate processing\n\n' +
      '**Use Case**: Start processing jobs on a node with multiple concurrent workers',
  })
  @ApiParam({
    name: 'nodeId',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Worker pool started successfully',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Started 4 worker(s) for node clq8x9z8x0000qh8x9z8x0000',
        },
        workersStarted: { type: 'number', example: 4 },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while starting workers',
  })
  async startWorker(
    @Param('nodeId') nodeId: string
  ): Promise<{ message: string; workersStarted: number }> {
    const workersStarted = await this.encodingService.startWorkerPool(nodeId);
    return {
      message: `Started ${workersStarted} worker(s) for node ${nodeId}`,
      workersStarted,
    };
  }

  /**
   * Stop encoding worker for a node
   */
  @Post('workers/:nodeId/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stop encoding worker for a node',
    description:
      'Gracefully stops the encoding worker for the specified node.\n\n' +
      '**Behavior**:\n' +
      '- Waits for current job to complete before stopping\n' +
      '- Does not interrupt running encoding jobs\n' +
      '- Worker can be restarted later\n\n' +
      '**Use Case**: Temporarily stop processing jobs on a node',
  })
  @ApiParam({
    name: 'nodeId',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Worker stopped successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Worker stopped for node clq8x9z8x0000qh8x9z8x0000' },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Node not found or worker not running',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while stopping worker',
  })
  async stopWorker(@Param('nodeId') nodeId: string): Promise<{ message: string }> {
    await this.encodingService.stopWorker(nodeId);
    return { message: `Worker stopped for node ${nodeId}` };
  }
}
