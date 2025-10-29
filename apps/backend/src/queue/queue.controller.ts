import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { type Job, JobStage } from '@prisma/client';
import { CancelJobDto } from './dto/cancel-job.dto';
import { CompleteJobDto } from './dto/complete-job.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { FailJobDto } from './dto/fail-job.dto';
import { JobStatsDto } from './dto/job-stats.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { QueueService } from './queue.service';

@ApiTags('queue')
@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  /**
   * Create a new encoding job
   */
  @Post()
  @ApiOperation({
    summary: 'Create a new encoding job',
    description:
      'Adds a new media file to the encoding queue. The job will be created in QUEUED stage.\n\n' +
      '**Job Lifecycle**:\n' +
      '1. **DETECTED** - File discovered during library scan\n' +
      '2. **QUEUED** - Ready to be processed (initial state when created via API)\n' +
      '3. **ENCODING** - Actively being encoded by a node\n' +
      '4. **VERIFYING** - Output file is being verified\n' +
      '5. **COMPLETED** - Successfully encoded and verified\n' +
      '6. **FAILED** - Encoding failed with error\n' +
      '7. **CANCELLED** - Job was cancelled by user\n\n' +
      '**Requirements**:\n' +
      '- Node must exist and be online\n' +
      '- Library must exist and be enabled\n' +
      '- Policy must exist and be valid\n' +
      '- File path must be absolute and accessible by the node',
  })
  @ApiCreatedResponse({
    description: 'Job created successfully and added to queue',
    type: CreateJobDto,
  })
  @ApiNotFoundResponse({
    description: 'Node, library, or policy not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while creating job',
  })
  async create(@Body() createJobDto: CreateJobDto): Promise<Job> {
    return this.queueService.create(createJobDto);
  }

  /**
   * Get all jobs with optional filtering
   */
  @Get()
  @ApiOperation({
    summary: 'List all jobs',
    description:
      'Returns all encoding jobs with optional filtering by stage and node.\n\n' +
      '**Use Cases**:\n' +
      '- **Queue monitoring**: Filter by stage=QUEUED to see pending work\n' +
      '- **Active jobs**: Filter by stage=ENCODING to see what is currently processing\n' +
      '- **Node-specific**: Filter by nodeId to see jobs for a specific node\n' +
      '- **History**: Filter by stage=COMPLETED or stage=FAILED to see past jobs\n\n' +
      '**Response includes**:\n' +
      '- Complete job details\n' +
      '- Associated node information\n' +
      '- Library details\n' +
      '- Applied policy configuration',
  })
  @ApiQuery({
    name: 'stage',
    required: false,
    enum: JobStage,
    description: 'Filter jobs by stage (QUEUED, ENCODING, COMPLETED, FAILED, etc.)',
    example: JobStage.QUEUED,
  })
  @ApiQuery({
    name: 'nodeId',
    required: false,
    description: 'Filter jobs by node ID',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search jobs by file path or file label',
    example: 'movie.mkv',
  })
  @ApiOkResponse({
    description: 'List of jobs retrieved successfully',
    type: [CreateJobDto],
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching jobs',
  })
  async findAll(
    @Query('stage') stage?: JobStage,
    @Query('nodeId') nodeId?: string,
    @Query('search') search?: string
  ): Promise<Job[]> {
    return this.queueService.findAll(stage, nodeId, search);
  }

  /**
   * Get job statistics
   */
  @Get('stats')
  @ApiOperation({
    summary: 'Get queue statistics',
    description:
      'Returns aggregate statistics for the job queue:\n' +
      '- **completed**: Total number of successfully completed jobs\n' +
      '- **failed**: Total number of failed jobs\n' +
      '- **encoding**: Number of jobs currently being processed\n' +
      '- **queued**: Number of jobs waiting to be processed\n' +
      '- **totalSavedBytes**: Cumulative space saved across all completed jobs\n\n' +
      '**Optional node filtering**: Include `nodeId` query parameter to get statistics for a specific node.\n\n' +
      '**Use Cases**:\n' +
      '- Dashboard metrics\n' +
      '- Queue health monitoring\n' +
      '- Capacity planning\n' +
      '- Node performance comparison',
  })
  @ApiQuery({
    name: 'nodeId',
    required: false,
    description: 'Filter statistics by node ID',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Queue statistics retrieved successfully',
    type: JobStatsDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching statistics',
  })
  async getStats(@Query('nodeId') nodeId?: string): Promise<JobStatsDto> {
    return this.queueService.getJobStats(nodeId);
  }

  /**
   * Get next job for a node
   */
  @Get('next/:nodeId')
  @ApiOperation({
    summary: 'Get next available job for a node',
    description:
      'Returns the next job in the queue for a specific node to process.\n\n' +
      '**Behavior**:\n' +
      '1. Checks if node exists\n' +
      '2. Verifies node has not exceeded concurrent job limit (from license)\n' +
      '3. Finds oldest QUEUED job assigned to this node\n' +
      '4. Automatically updates job to ENCODING stage\n' +
      '5. Sets startedAt timestamp\n' +
      '6. Returns job with full policy and library details\n\n' +
      '**Returns null if**:\n' +
      '- No queued jobs available for this node\n' +
      '- Node is at max concurrent job capacity\n\n' +
      '**Use Case**: Nodes poll this endpoint to fetch work',
  })
  @ApiParam({
    name: 'nodeId',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Next job retrieved and started, or null if none available',
    type: CreateJobDto,
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching next job',
  })
  async getNextJob(@Param('nodeId') nodeId: string): Promise<Job | null> {
    return this.queueService.getNextJob(nodeId);
  }

  /**
   * Get a specific job by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get job details',
    description:
      'Retrieves detailed information about a specific job including:\n' +
      '- **Complete Job Info**: All job properties and current state\n' +
      '- **Node Details**: Node name, status, acceleration type\n' +
      '- **Library Info**: Library name, path, media type\n' +
      '- **Policy Details**: Encoding policy with all settings\n\n' +
      '**Use Case**: Job detail page, progress monitoring, debugging',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job retrieved successfully',
    type: CreateJobDto,
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching job',
  })
  async findOne(@Param('id') id: string): Promise<Job> {
    return this.queueService.findOne(id);
  }

  /**
   * Update job progress
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update job progress',
    description:
      'Updates the progress of an encoding job. Used by nodes to report encoding progress.\n\n' +
      '**Updatable Fields**:\n' +
      '- **progress**: Current completion percentage (0.0 to 100.0)\n' +
      '- **etaSeconds**: Estimated time to completion in seconds\n' +
      '- **stage**: Current job stage (ENCODING, VERIFYING, etc.)\n\n' +
      '**All fields are optional** (partial update).\n\n' +
      '**Use Case**: Nodes send progress updates every few seconds during encoding',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job progress updated successfully',
    type: UpdateJobDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid progress data provided',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while updating job',
  })
  async update(@Param('id') id: string, @Body() updateJobDto: UpdateJobDto): Promise<Job> {
    return this.queueService.updateProgress(id, updateJobDto);
  }

  /**
   * Complete a job successfully
   */
  @Post(':id/complete')
  @ApiOperation({
    summary: 'Mark job as completed',
    description:
      'Marks a job as successfully completed and updates final metrics.\n\n' +
      '**Actions Performed**:\n' +
      '1. Updates job stage to COMPLETED\n' +
      '2. Sets progress to 100%\n' +
      '3. Records final file size and space savings\n' +
      '4. Sets completedAt timestamp\n' +
      '5. Updates daily metrics for node and license\n\n' +
      '**Metrics Updated**:\n' +
      '- Node-specific daily metrics (jobs completed, bytes saved)\n' +
      '- License-wide daily metrics (aggregate across all nodes)\n\n' +
      '**Use Case**: Nodes call this endpoint after successfully encoding and verifying a file',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job completed successfully',
    type: CompleteJobDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid completion data or job not in correct state',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while completing job',
  })
  async complete(@Param('id') id: string, @Body() completeJobDto: CompleteJobDto): Promise<Job> {
    return this.queueService.completeJob(id, completeJobDto);
  }

  /**
   * Mark a job as failed
   */
  @Post(':id/fail')
  @ApiOperation({
    summary: 'Mark job as failed',
    description:
      'Marks a job as failed with an error message.\n\n' +
      '**Actions Performed**:\n' +
      '1. Updates job stage to FAILED\n' +
      '2. Records error message\n' +
      '3. Sets completedAt timestamp\n\n' +
      '**Common Failure Reasons**:\n' +
      '- FFmpeg encoding error\n' +
      '- Unsupported codec or format\n' +
      '- File access/permission issues\n' +
      '- Insufficient disk space\n' +
      '- Hardware acceleration failure\n\n' +
      '**Use Case**: Nodes call this endpoint when encoding fails',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job marked as failed',
    type: FailJobDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid error data or job not in correct state',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while failing job',
  })
  async fail(@Param('id') id: string, @Body() failJobDto: FailJobDto): Promise<Job> {
    return this.queueService.failJob(id, failJobDto.error);
  }

  /**
   * Cancel a job
   */
  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a job',
    description:
      'Cancels a job that is queued or in progress.\n\n' +
      '**Actions Performed**:\n' +
      '1. Validates job can be cancelled (not already completed)\n' +
      '2. Updates job stage to CANCELLED\n' +
      '3. Sets completedAt timestamp\n' +
      '4. Optionally blacklists the file (prevents automatic re-encoding)\n\n' +
      '**Cancel Options**:\n' +
      '- **Cancel & Retry** (blacklist=false): Job can be retried later\n' +
      '- **Cancel & Blacklist** (blacklist=true): File will never be auto-encoded again\n\n' +
      '**Note**: Cancelling a job that is actively encoding may require node cleanup.\n\n' +
      '**Use Case**: User cancels a job from the UI with option to blacklist',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job cancelled successfully',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Cannot cancel a completed job',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while cancelling job',
  })
  async cancel(@Param('id') id: string, @Body() cancelJobDto: CancelJobDto): Promise<Job> {
    return this.queueService.cancelJob(id, cancelJobDto.blacklist ?? false);
  }

  /**
   * Unblacklist a job to allow retry
   */
  @Post(':id/unblacklist')
  @ApiOperation({
    summary: 'Unblacklist a job to allow retry',
    description:
      'Removes the blacklist flag from a cancelled job, allowing it to be retried.\n\n' +
      '**Actions Performed**:\n' +
      '1. Validates job exists and is in CANCELLED stage\n' +
      '2. Validates job is currently blacklisted\n' +
      '3. Sets isBlacklisted to false\n\n' +
      '**Use Case**: User decides to retry a previously blacklisted file',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job unblacklisted successfully - can now be retried',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Job is not in CANCELLED stage or is not blacklisted',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while unblacklisting job',
  })
  async unblacklist(@Param('id') id: string): Promise<Job> {
    return this.queueService.unblacklistJob(id);
  }

  /**
   * Pause an encoding job
   */
  @Post(':id/pause')
  @ApiOperation({
    summary: 'Pause an encoding job',
    description:
      'Pauses an actively encoding job using SIGSTOP signal.\n\n' +
      '**Actions Performed**:\n' +
      '1. Validates job is in ENCODING stage\n' +
      '2. Updates job stage to PAUSED\n' +
      '3. Sends SIGSTOP signal to FFmpeg process\n\n' +
      '**Use Case**: User wants to temporarily stop encoding to free up resources',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job paused successfully',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Job is not in ENCODING stage',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while pausing job',
  })
  async pause(@Param('id') id: string): Promise<Job> {
    return this.queueService.pauseJob(id);
  }

  /**
   * Resume a paused job
   */
  @Post(':id/resume')
  @ApiOperation({
    summary: 'Resume a paused job',
    description:
      'Resumes a paused encoding job using SIGCONT signal.\n\n' +
      '**Actions Performed**:\n' +
      '1. Validates job is in PAUSED stage\n' +
      '2. Updates job stage to ENCODING\n' +
      '3. Sends SIGCONT signal to FFmpeg process\n\n' +
      '**Use Case**: User wants to continue encoding a previously paused job',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job resumed successfully',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Job is not in PAUSED stage',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while resuming job',
  })
  async resume(@Param('id') id: string): Promise<Job> {
    return this.queueService.resumeJob(id);
  }

  /**
   * Retry a failed or cancelled job
   */
  @Post(':id/retry')
  @ApiOperation({
    summary: 'Retry a failed or cancelled job',
    description:
      'Resets a failed or cancelled job back to QUEUED stage.\n\n' +
      '**Actions Performed**:\n' +
      '1. Validates job is in FAILED or CANCELLED stage\n' +
      '2. Updates job stage to QUEUED\n' +
      '3. Resets progress to 0%\n' +
      '4. Clears error message and timestamps\n\n' +
      '**Use Case**: User wants to retry a job that failed or was cancelled',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job retried successfully and moved back to queue',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Job is not in FAILED or CANCELLED stage',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while retrying job',
  })
  async retry(@Param('id') id: string): Promise<Job> {
    return this.queueService.retryJob(id);
  }

  /**
   * Force start a queued job immediately
   */
  @Post(':id/force-start')
  @ApiOperation({
    summary: 'Force start a queued job immediately',
    description:
      'Moves a queued job to DETECTED stage immediately, bypassing the normal queue order.\n\n' +
      '**Actions Performed**:\n' +
      '1. Validates job is in QUEUED or DETECTED stage\n' +
      '2. Updates job stage to DETECTED\n' +
      '3. Updates createdAt timestamp to prioritize it (worker processes oldest first)\n' +
      '4. Health check worker picks it up within 2 seconds\n\n' +
      '**Use Case**: User wants to encode a specific file immediately for testing or priority',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job force-started successfully',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Job is not in QUEUED or DETECTED stage',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while force-starting job',
  })
  async forceStart(@Param('id') id: string): Promise<Job> {
    return this.queueService.forceStartJob(id);
  }

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
   * Delete a job
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a job',
    description:
      'Permanently deletes a job from the database.\n\n' +
      '**Warning**: This action:\n' +
      '- **Permanently removes** the job record\n' +
      '- **Does not affect** the actual media file\n' +
      '- **Cannot be undone**\n\n' +
      '**Use Case**: Cleanup of old completed/failed jobs, database maintenance',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job deleted successfully (returns 204 No Content)',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while deleting job',
  })
  async remove(@Param('id') id: string): Promise<void> {
    return this.queueService.remove(id);
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
}
