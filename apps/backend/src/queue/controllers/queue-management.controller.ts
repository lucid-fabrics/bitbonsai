import { Controller, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JobStage } from '@prisma/client';
import { QueueService } from '../queue.service';

@ApiTags('queue')
@Controller('queue')
export class QueueManagementController {
  constructor(private readonly queueService: QueueService) {}

  /**
   * Cancel all queued jobs
   */
  @Post('cancel-all')
  @ApiOperation({
    summary: 'Cancel all queued jobs',
    description:
      'Cancels ALL jobs that are currently in QUEUED stage.\n\n' +
      '**Actions Performed**:\n' +
      '1. Finds all jobs with stage = QUEUED\n' +
      '2. Updates them to stage = CANCELLED\n' +
      '3. Sets completedAt timestamp for each\n\n' +
      '**Safety**: Only affects QUEUED jobs. Does not cancel ENCODING jobs.\n\n' +
      '**Use Case**: User wants to stop all pending encoding work',
  })
  @ApiOkResponse({
    description: 'All queued jobs cancelled successfully',
    schema: {
      type: 'object',
      properties: {
        cancelledCount: { type: 'number', example: 39 },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while cancelling jobs',
  })
  async cancelAll(): Promise<{ cancelledCount: number }> {
    return this.queueService.cancelAllQueued();
  }

  /**
   * Retry all cancelled jobs
   */
  @Post('retry-all-cancelled')
  @ApiOperation({
    summary: 'Retry all cancelled jobs',
    description:
      'Resets ALL cancelled jobs back to QUEUED stage.\n\n' +
      '**Actions Performed**:\n' +
      '1. Finds all jobs with stage = CANCELLED\n' +
      '2. Updates them to stage = QUEUED\n' +
      '3. Resets progress to 0% and clears timestamps\n\n' +
      '**Returns**:\n' +
      '- Count of retried jobs\n' +
      '- Total file size of all retried jobs\n' +
      '- List of job IDs and file labels\n\n' +
      '**Use Case**: User wants to retry all previously cancelled jobs',
  })
  @ApiOkResponse({
    description: 'All cancelled jobs retried successfully',
    schema: {
      type: 'object',
      properties: {
        retriedCount: { type: 'number', example: 39 },
        totalSizeBytes: { type: 'string', example: '524288000000' },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              fileLabel: { type: 'string' },
              beforeSizeBytes: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while retrying jobs',
  })
  async retryAllCancelled(): Promise<{
    retriedCount: number;
    totalSizeBytes: string;
    jobs: Array<{ id: string; fileLabel: string; beforeSizeBytes: bigint }>;
  }> {
    return this.queueService.retryAllCancelled();
  }

  /**
   * Retry all failed jobs (optionally filtered by error category)
   */
  @Post('retry-all-failed')
  @ApiOperation({
    summary: 'Retry all failed jobs',
    description:
      'Resets ALL failed jobs (or failed jobs matching a specific error category) back to QUEUED stage.\n\n' +
      '**Actions Performed**:\n' +
      '1. Finds all jobs with stage = FAILED\n' +
      '2. Optionally filters by error category if errorFilter query param is provided\n' +
      '3. Updates matching jobs to stage = QUEUED\n' +
      '4. Resets progress to 0% and clears timestamps\n\n' +
      '**Error Categories**:\n' +
      '- FFmpeg Error Code {number} (e.g., "FFmpeg Error Code 255")\n' +
      '- FFmpeg Error (Other)\n' +
      '- Job Timeout/Stuck\n' +
      '- File Not Found\n' +
      '- Codec Error\n' +
      '- Network Error\n' +
      '- Disk Space Error\n' +
      '- Permission Error\n' +
      '- Memory Error\n' +
      '- [Original error message if no category matches]\n\n' +
      '**Returns**:\n' +
      '- Count of retried jobs\n' +
      '- List of retried jobs with their error messages\n\n' +
      '**Use Case**: Bulk retry failed jobs, optionally filtering by error category (e.g., retry all FFmpeg exit code 255 errors)',
  })
  @ApiQuery({
    name: 'errorFilter',
    required: false,
    type: String,
    description:
      'Optional: Filter failed jobs by error category (e.g., "FFmpeg Error Code 255", "Job Timeout/Stuck")',
  })
  @ApiOkResponse({
    description: 'Failed jobs have been retried',
    schema: {
      example: {
        retriedCount: 5,
        jobs: [
          {
            id: 'job-123',
            fileLabel: 'movie.mp4',
            error: 'FFmpeg failed with exit code 1',
          },
        ],
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while retrying failed jobs',
  })
  async retryAllFailed(@Query('errorFilter') errorFilter?: string): Promise<{
    retriedCount: number;
    jobs: Array<{ id: string; fileLabel: string; error: string }>;
  }> {
    return this.queueService.retryAllFailed(errorFilter);
  }

  /**
   * Skip all jobs where codec already matches target
   */
  @Post('skip-codec-match')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Skip all jobs where codec already matches target',
    description:
      'Bulk skip encoding for all NEEDS_DECISION jobs where the source codec matches the target codec.\n\n' +
      'This is useful when:\n' +
      "- A policy's target codec was changed after jobs were created\n" +
      '- Files were already optimized but re-added to the queue\n\n' +
      '**What happens**:\n' +
      '- Jobs with CODEC_ALREADY_MATCHES_TARGET issue are marked as COMPLETED\n' +
      '- No encoding is performed, original files remain unchanged\n' +
      '- Progress is set to 100%, file size stays the same\n\n' +
      '**Returns**:\n' +
      '- Count of skipped jobs\n' +
      '- List of skipped jobs with their file labels',
  })
  @ApiOkResponse({
    description: 'Jobs have been skipped successfully',
    schema: {
      example: {
        skippedCount: 5,
        jobs: [
          {
            id: 'job-123',
            fileLabel: 'movie.mkv',
            sourceCodec: 'hevc',
            targetCodec: 'hevc',
          },
        ],
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while skipping jobs',
  })
  async skipAllCodecMatch(): Promise<{
    skippedCount: number;
    jobs: Array<{ id: string; fileLabel: string; sourceCodec: string; targetCodec: string }>;
  }> {
    return this.queueService.skipAllCodecMatch();
  }

  /**
   * Force encode all jobs where codec already matches target
   */
  @Post('force-encode-codec-match')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Force encode all jobs where codec already matches target',
    description:
      'Bulk force re-encoding for all NEEDS_DECISION jobs where the source codec matches the target codec.\n\n' +
      'This is useful when:\n' +
      '- You want to re-compress files at a different quality/CRF setting\n' +
      '- You want to change container format while re-encoding\n\n' +
      '**What happens**:\n' +
      '- Jobs with CODEC_ALREADY_MATCHES_TARGET issue are moved to QUEUED\n' +
      '- Files will be re-encoded despite already being in target codec\n' +
      '- This may increase file size if quality settings are similar',
  })
  @ApiOkResponse({
    description: 'Successfully queued codec-match jobs for force encoding',
    schema: {
      type: 'object',
      properties: {
        queuedCount: {
          type: 'number',
          description: 'Number of jobs queued for force encoding',
          example: 5,
        },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'clxx123456789' },
              fileLabel: { type: 'string', example: 'movie.mkv' },
              sourceCodec: { type: 'string', example: 'hevc' },
              targetCodec: { type: 'string', example: 'hevc' },
            },
          },
        },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while queueing jobs',
  })
  async forceEncodeAllCodecMatch(): Promise<{
    queuedCount: number;
    jobs: Array<{ id: string; fileLabel: string; sourceCodec: string; targetCodec: string }>;
  }> {
    return this.queueService.forceEncodeAllCodecMatch();
  }

  /**
   * Clear all jobs or jobs matching specific statuses
   */
  @Post('clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear all jobs or jobs with specific statuses',
    description:
      'Permanently deletes multiple jobs from the database.\n\n' +
      '**Warning**: This action:\n' +
      '- **Permanently removes** job records\n' +
      '- **Does not affect** actual media files\n' +
      '- **Cannot be undone**\n\n' +
      '**Query Parameters**:\n' +
      '- `stages`: Optional comma-separated list of job stages to delete (COMPLETED, FAILED, CANCELLED, etc.)\n' +
      '- If no stages specified, **ALL jobs will be deleted**\n\n' +
      '**Examples**:\n' +
      '- `/queue/clear` - Deletes ALL jobs\n' +
      '- `/queue/clear?stages=COMPLETED,FAILED` - Deletes only completed and failed jobs',
  })
  @ApiQuery({
    name: 'stages',
    required: false,
    description: 'Comma-separated list of job stages to delete (e.g., COMPLETED,FAILED,CANCELLED)',
    example: 'COMPLETED,FAILED',
  })
  @ApiOkResponse({
    description: 'Jobs cleared successfully, returns count of deleted jobs',
    schema: {
      type: 'object',
      properties: {
        deleted: {
          type: 'number',
          description: 'Number of jobs deleted',
          example: 42,
        },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while clearing jobs',
  })
  async clearJobs(@Query('stages') stagesParam?: string): Promise<{ deleted: number }> {
    const stages = stagesParam
      ? (stagesParam.split(',').map((s) => s.trim()) as JobStage[])
      : undefined;

    const deleted = await this.queueService.clearJobs(stages);
    return { deleted };
  }

  /**
   * Redistribute queued jobs across nodes
   */
  @Post('rebalance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Redistribute queued jobs across nodes',
    description:
      'Rebalances QUEUED jobs across online nodes to ensure optimal load distribution.\n\n' +
      '**When to use**:\n' +
      '- After adding a new node with shared storage\n' +
      '- When one node has many queued jobs but another is idle\n' +
      '- After changing node configurations (hasSharedStorage, maxWorkers)\n\n' +
      '**How it works**:\n' +
      '- Identifies overloaded nodes (>80% capacity)\n' +
      '- Identifies underutilized nodes (<50% capacity)\n' +
      '- Moves up to 5 QUEUED jobs from each overloaded node to underutilized nodes\n' +
      '- Only rebalances LOCAL nodes (not REMOTE)\n\n' +
      '**Returns**: Number of jobs redistributed',
  })
  @ApiOkResponse({
    description: 'Jobs redistributed successfully',
    schema: {
      type: 'object',
      properties: {
        jobsRebalanced: {
          type: 'number',
          example: 7,
          description: 'Number of jobs that were moved to different nodes',
        },
        message: {
          type: 'string',
          example: 'Redistributed 7 job(s) across nodes',
        },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred during rebalancing',
  })
  async rebalanceJobs(): Promise<{ jobsRebalanced: number; message: string }> {
    const jobsRebalanced = await this.queueService.rebalanceJobs();

    return {
      jobsRebalanced,
      message:
        jobsRebalanced > 0
          ? `Redistributed ${jobsRebalanced} job(s) across nodes`
          : 'No rebalancing needed - jobs are already well distributed',
    };
  }

  /**
   * Fix stuck transfers - reset TRANSFERRING jobs back to QUEUED
   */
  @Post('fix-stuck-transfers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fix stuck transfers',
    description:
      'Resets jobs stuck in TRANSFERRING stage back to QUEUED.\n\n' +
      '**When to use**:\n' +
      '- When jobs are stuck in TRANSFERRING with 0% progress\n' +
      '- After a system crash or restart\n' +
      '- When transfers failed but didnt update stage properly\n\n' +
      '**How it works**:\n' +
      '- Finds all jobs in TRANSFERRING stage with 0% progress for more than 5 minutes\n' +
      '- Resets them back to QUEUED stage\n' +
      '- Clears transfer error and progress fields',
  })
  @ApiOkResponse({
    description: 'Stuck transfers fixed',
    schema: {
      type: 'object',
      properties: {
        fixed: {
          type: 'number',
          example: 5,
          description: 'Number of stuck transfers that were reset',
        },
        message: {
          type: 'string',
          example: 'Reset 5 stuck transfer(s) back to QUEUED',
        },
      },
    },
  })
  async fixStuckTransfers(): Promise<{ fixed: number; message: string }> {
    const fixed = await this.queueService.fixStuckTransfers();

    return {
      fixed,
      message:
        fixed > 0 ? `Reset ${fixed} stuck transfer(s) back to QUEUED` : 'No stuck transfers found',
    };
  }
}
