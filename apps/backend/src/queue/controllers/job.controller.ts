import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type Job, Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { NodeConfigService } from '../../core/services/node-config.service';
import { CancelJobDto } from '../dto/cancel-job.dto';
import { CompleteJobDto } from '../dto/complete-job.dto';
import { CreateJobDto } from '../dto/create-job.dto';
import { DelegateJobDto } from '../dto/delegate-job.dto';
import { FailJobDto } from '../dto/fail-job.dto';
import { ResolveDecisionDto } from '../dto/resolve-decision.dto';
import { UpdateJobDto } from '../dto/update-job.dto';
import { UpdatePriorityDto } from '../dto/update-priority.dto';
import { QueueService } from '../queue.service';
import { JobHistoryService } from '../services/job-history.service';

@ApiTags('queue')
@Controller('queue')
export class JobController {
  private readonly logger = new Logger(JobController.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly jobHistoryService: JobHistoryService,
    private readonly nodeConfig: NodeConfigService
  ) {}

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
   * Get job failure/event history timeline
   */
  @Get(':id/history')
  @ApiOperation({
    summary: 'Get job event history timeline',
    description:
      'Retrieves the complete event history for a job, including all failures, cancellations, restarts, and auto-heal events.\n\n' +
      '**History Includes**:\n' +
      '- **FAILED** - When encoding failed with error details\n' +
      '- **CANCELLED** - When user or system cancelled the job\n' +
      '- **RESTARTED** - When job was manually restarted\n' +
      '- **AUTO_HEALED** - When job auto-resumed after backend restart\n' +
      '- **BACKEND_RESTART** - When encoding was interrupted by backend restart\n' +
      '- **TIMEOUT** - When encoding exceeded time limits\n\n' +
      '**Each Event Contains**:\n' +
      '- User-friendly system message explaining what happened\n' +
      '- Progress percentage when event occurred\n' +
      '- Error details (if applicable)\n' +
      '- Performance metrics (FPS, ETA) at time of event\n' +
      '- Timestamp of when event occurred\n\n' +
      '**Use Case**: Display failure history timeline in UI for debugging and user transparency',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job history timeline retrieved successfully (ordered newest to oldest)',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'clq8x9z8x0004qh8x9z8x0004' },
          eventType: {
            type: 'string',
            enum: ['FAILED', 'CANCELLED', 'RESTARTED', 'AUTO_HEALED', 'BACKEND_RESTART', 'TIMEOUT'],
          },
          stage: { type: 'string', example: 'ENCODING' },
          progress: { type: 'number', example: 45.3 },
          systemMessage: { type: 'string', example: 'Attempt #2 failed at 45.3%' },
          errorMessage: { type: 'string', nullable: true },
          errorDetails: { type: 'string', nullable: true },
          wasAutoHealed: { type: 'boolean', example: false },
          tempFileExists: { type: 'boolean', nullable: true },
          retryNumber: { type: 'number', nullable: true },
          triggeredBy: { type: 'string', nullable: true, example: 'USER' },
          fps: { type: 'number', nullable: true, example: 12.5 },
          etaSeconds: { type: 'number', nullable: true, example: 3600 },
          startedFromSeconds: { type: 'number', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching job history',
  })
  async getJobHistory(@Param('id') id: string): Promise<unknown[]> {
    // Verify job exists first
    await this.queueService.findOne(id);

    // Return history timeline
    return this.jobHistoryService.getJobHistory(id);
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
  @ApiForbiddenResponse({
    description: 'Node does not own this job',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while updating job',
  })
  async update(@Param('id') id: string, @Body() updateJobDto: UpdateJobDto): Promise<Job> {
    // MULTI-NODE SECURITY: Validate that the requesting node owns the job
    // This prevents cross-node status pollution (e.g., zombie FFmpeg from Node B
    // sending PATCH requests that mark Node A's jobs as FAILED)
    const currentNodeId = this.nodeConfig.getNodeId();
    const isMainNode = this.nodeConfig.isMainNode();

    // Get the job to check ownership
    const job = await this.queueService.findOne(id);
    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }

    // Allow updates if:
    // 1. This is the MAIN node (can update any job for admin purposes)
    // 2. Job has no nodeId assigned yet (in DETECTED, QUEUED stages before assignment)
    // 3. The current node owns the job
    const isJobOwner = !job.nodeId || job.nodeId === currentNodeId;
    if (!isMainNode && !isJobOwner) {
      this.logger.warn(
        `⚠️ Cross-node update rejected: Node ${currentNodeId} attempted to update job ${id} owned by node ${job.nodeId}`
      );
      throw new ForbiddenException(
        `Node ${currentNodeId} cannot update job ${id} - job is assigned to node ${job.nodeId}`
      );
    }

    // MULTI-NODE: Use the generic update() method which supports all fields
    return this.queueService.update(id, updateJobDto as Prisma.JobUpdateInput);
  }

  /**
   * Update job progress (for LINKED nodes)
   */
  @Patch(':id/progress')
  @ApiOperation({
    summary: 'Update job progress (for LINKED nodes)',
    description:
      'Updates the progress of an encoding job. Used by LINKED nodes to report encoding progress.\n\n' +
      '**Updatable Fields**:\n' +
      '- **progress**: Current completion percentage (0.0 to 100.0)\n' +
      '- **etaSeconds**: Estimated time to completion in seconds\n\n' +
      '**Use Case**: LINKED nodes send progress updates every few seconds during encoding',
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
  async updateJobProgress(
    @Param('id') id: string,
    @Body() body: { progress: number; etaSeconds: number }
  ): Promise<Job> {
    return this.queueService.updateProgress(id, {
      progress: body.progress,
      etaSeconds: body.etaSeconds,
    });
  }

  /**
   * Update job stage (for LINKED nodes)
   */
  @Patch(':id/stage')
  @ApiOperation({
    summary: 'Update job stage (for LINKED nodes)',
    description:
      'Updates the stage of an encoding job. Used by LINKED nodes to report stage changes.\n\n' +
      '**Use Case**: LINKED nodes call this to move jobs between stages (ENCODING, VERIFYING, etc.)',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job stage updated successfully',
    type: UpdateJobDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid stage data provided',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while updating job',
  })
  async updateJobStage(@Param('id') id: string, @Body() body: UpdateJobDto): Promise<Job> {
    return this.queueService.updateProgress(id, body);
  }

  /**
   * Update job priority
   */
  @Patch(':id/priority')
  @ApiOperation({
    summary: 'Update job priority',
    description:
      'Updates the priority level of a job for queue ordering.\n\n' +
      '**Priority Levels**:\n' +
      '- **0 = Normal** (default) - Standard FIFO queue order\n' +
      '- **1 = High** - Processed before normal priority jobs\n' +
      '- **2 = Top Priority** - Processed first (max 3 at once)\n\n' +
      '**Behavior**:\n' +
      '1. Queue ordering: ORDER BY priority DESC, healthScore DESC, createdAt ASC\n' +
      '2. Max 3 top priority jobs enforced (returns 400 if exceeded)\n' +
      '3. Priority auto-resets to 0 on completion/failure\n' +
      '4. Live renice for actively encoding jobs (best-effort)\n\n' +
      '**Process Priority**:\n' +
      '- Top (2): nice -n -10 (higher CPU priority)\n' +
      '- High (1): nice -n -5\n' +
      '- Normal (0): nice -n 0\n\n' +
      '**Use Case**: Prioritize important encoding jobs without canceling others',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job priority updated successfully',
    type: UpdatePriorityDto,
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Invalid priority level or max 3 top priority jobs exceeded',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while updating priority',
  })
  async updatePriority(
    @Param('id') id: string,
    @Body() updatePriorityDto: UpdatePriorityDto
  ): Promise<Job> {
    return this.queueService.updateJobPriority(id, updatePriorityDto.priority);
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
   * Force recheck a job's health status
   */
  @Post(':id/recheck')
  @ApiOperation({
    summary: 'Force recheck health status for a job',
    description:
      'Clears health check data and forces the job through health check again.\n\n' +
      '**Actions Performed**:\n' +
      '1. Clears all health check data (status, score, message, etc.)\n' +
      '2. Clears decision data if present\n' +
      '3. Resets job to DETECTED stage\n' +
      '4. Health check worker picks it up within 2 seconds\n\n' +
      '**Use Case**: Testing health check system, forcing re-analysis after code changes',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job health check cleared and reset to DETECTED',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while rechecking job',
  })
  async recheckHealth(@Param('id') id: string): Promise<Job> {
    return this.queueService.recheckHealth(id);
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
   * Recheck a failed job to validate if it's truly failed or completed
   */
  @Post(':id/recheck-failed')
  @ApiOperation({
    summary: 'Recheck a failed job',
    description:
      'Re-validates a FAILED job by checking file existence and health.\n\n' +
      '**Actions Performed**:\n' +
      '1. Validates job is in FAILED stage\n' +
      '2. Checks if encoded file exists at original path\n' +
      '3. Runs health check using ffprobe\n' +
      '4. If file is healthy, recalculates file sizes\n' +
      '5. Moves job back to COMPLETED stage\n' +
      '6. Clears error message and failedAt timestamp\n\n' +
      '**Use Case**: Jobs incorrectly marked as FAILED due to race conditions or verification issues.\n\n' +
      '**Result**: Job moved to COMPLETED if file is valid, or remains FAILED with updated error message.',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job rechecked successfully',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Job is not in FAILED stage',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while rechecking job',
  })
  async recheckJob(@Param('id') id: string): Promise<Job> {
    return this.queueService.recheckFailedJob(id);
  }

  /**
   * Resolve user decision for a job requiring action
   */
  @Post(':id/resolve-decision')
  @ApiOperation({
    summary: 'Resolve health check decision',
    description:
      'Resolves a user decision for a job in NEEDS_DECISION stage.\n\n' +
      '**When Required**:\n' +
      '- Job has blocker health check issues requiring user input\n' +
      '- Examples: AC3 audio incompatible with MP4 container, resolution exceeds limits\n\n' +
      '**Actions Performed**:\n' +
      '1. Validates job is in NEEDS_DECISION stage\n' +
      '2. Saves user decision data (e.g., "remux to MKV" or "proceed anyway")\n' +
      '3. Clears decision flags\n' +
      '4. Moves job to QUEUED stage for processing\n\n' +
      '**Decision Data Format**:\n' +
      '```json\n' +
      '{\n' +
      '  "audio_codec_incompatible": "remux_to_mkv",\n' +
      '  "resolution_too_high": "proceed_anyway"\n' +
      '}\n' +
      '```\n\n' +
      '**Use Case**: User reviews health check issues in UI and selects how to proceed with encoding',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'cmhk7s91m003rrz53eqrwruyf',
  })
  @ApiOkResponse({
    description: 'Decision resolved successfully, job moved to QUEUED',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Job is not in NEEDS_DECISION stage',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while resolving decision',
  })
  async resolveDecision(
    @Param('id') id: string,
    @Body() resolveDecisionDto: ResolveDecisionDto
  ): Promise<Job> {
    return this.queueService.resolveDecision(id, resolveDecisionDto.decisionData);
  }

  /**
   * Detect and requeue completed job if no compression occurred
   */
  @Post(':id/detect-and-requeue')
  @ApiOperation({
    summary: 'Detect and requeue if no compression occurred',
    description:
      'Checks if a COMPLETED job actually compressed the file.\n\n' +
      '**Actions Performed**:\n' +
      '1. Validates job is in COMPLETED stage\n' +
      '2. Checks if savedBytes <= 0 (same size or larger)\n' +
      '3. If no compression detected: moves job back to QUEUED stage\n' +
      '4. Resets progress, clears completion data\n' +
      '5. If compression was successful: returns error\n\n' +
      '**Use Case**: Detect completed jobs where encoding failed to compress the file.\n\n' +
      '**Result**: Job moved to QUEUED if no compression, or error if compression was successful.',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Job requeued successfully (no compression detected)',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Job is not in COMPLETED stage or compression was successful',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while detecting compression',
  })
  async detectAndRequeue(@Param('id') id: string): Promise<Job> {
    return this.queueService.detectAndRequeueIfUncompressed(id);
  }

  /**
   * Manually delegate a job to a specific node
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post(':id/delegate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delegate job to specific node',
    description:
      'Manually assigns a job to a specific node, bypassing the automatic job attribution algorithm.\n\n' +
      '**Use Cases**:\n' +
      '- Override automatic node selection\n' +
      '- Move job to node with specific hardware (GPU, faster CPU)\n' +
      '- Balance load manually across nodes\n\n' +
      '**Behavior**:\n' +
      '- Sets manualAssignment=true to prevent auto-reassignment\n' +
      '- Updates originalNodeId if not already set\n' +
      '- Job can be in any stage (QUEUED, PAUSED, ENCODING)',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Job successfully delegated to target node',
  })
  @ApiNotFoundResponse({
    description: 'Job or target node not found',
  })
  @ApiBadRequestResponse({
    description: 'Invalid target node (offline, not available, etc.)',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while delegating job',
  })
  async delegateJob(@Param('id') id: string, @Body() delegateDto: DelegateJobDto): Promise<Job> {
    return this.queueService.delegateJob(id, delegateDto.targetNodeId);
  }

  /**
   * Request to keep original file after encoding
   */
  @Post(':id/keep-original')
  @ApiOperation({
    summary: 'Request to keep original file after encoding',
    description:
      'Marks an encoding job to preserve the original file when complete.\n\n' +
      '**Actions Performed**:\n' +
      '1. Validates job is in ENCODING stage\n' +
      '2. Sets keepOriginalRequested flag to true\n' +
      '3. Captures original file size\n\n' +
      '**On Completion**:\n' +
      '- Original file renamed to .original extension\n' +
      '- Encoded file takes the original filename\n' +
      '- Both files preserved on disk\n\n' +
      '**Use Case**: User wants to keep original file for comparison or backup',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Keep original requested successfully',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Job is not in ENCODING stage',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while requesting keep original',
  })
  async keepOriginal(@Param('id') id: string): Promise<Job> {
    return this.queueService.requestKeepOriginal(id);
  }

  /**
   * Delete original backup file
   */
  @Delete(':id/original')
  @ApiOperation({
    summary: 'Delete original backup file to free space',
    description:
      'Permanently deletes the .original backup file.\n\n' +
      '**Actions Performed**:\n' +
      '1. Validates original backup exists\n' +
      '2. Deletes the .original file from disk\n' +
      '3. Updates job to clear backup info\n' +
      '4. Returns freed space in bytes\n\n' +
      '**Warning**: This action cannot be undone.\n\n' +
      '**Use Case**: User wants to free disk space by removing original backup',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Original backup deleted successfully',
    schema: {
      type: 'object',
      properties: {
        freedSpace: { type: 'string', example: '524288000' },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'No original backup exists for this job',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while deleting original backup',
  })
  async deleteOriginal(@Param('id') id: string): Promise<{ freedSpace: string }> {
    const result = await this.queueService.deleteOriginalBackup(id);
    return { freedSpace: result.freedSpace.toString() };
  }

  /**
   * Restore original file
   */
  @Post(':id/restore-original')
  @ApiOperation({
    summary: 'Restore original file (swap with encoded)',
    description:
      'Swaps the encoded file with the original backup.\n\n' +
      '**Actions Performed**:\n' +
      '1. Validates original backup exists\n' +
      '2. Renames encoded file to .encoded extension\n' +
      '3. Restores original file to main filename\n' +
      '4. Updates job backup path to .encoded\n\n' +
      '**Result**: Original becomes active file, encoded becomes backup.\n\n' +
      '**Use Case**: User wants to revert to original file after encoding',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Original file restored successfully',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'No original backup to restore',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while restoring original',
  })
  async restoreOriginal(@Param('id') id: string): Promise<Job> {
    return this.queueService.restoreOriginal(id);
  }
}
