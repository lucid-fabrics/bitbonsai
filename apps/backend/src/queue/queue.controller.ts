import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import * as fs from 'fs/promises';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
import { EncodingPreviewService } from '../encoding/encoding-preview.service';
import { FfmpegService } from '../encoding/ffmpeg.service';
import { CancelJobDto } from './dto/cancel-job.dto';
import { CompleteJobDto } from './dto/complete-job.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { FailJobDto } from './dto/fail-job.dto';
import { JobStatsDto } from './dto/job-stats.dto';
import { ResolveDecisionDto } from './dto/resolve-decision.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdatePriorityDto } from './dto/update-priority.dto';
import { QueueService } from './queue.service';
import { JobHistoryService } from './services/job-history.service';

@ApiTags('queue')
@Controller('queue')
export class QueueController {
  private readonly logger = new Logger(QueueController.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly jobHistoryService: JobHistoryService,
    readonly _previewService: EncodingPreviewService,
    readonly _ffmpegService: FfmpegService
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
  @ApiQuery({
    name: 'libraryId',
    required: false,
    description: 'Filter jobs by library ID',
    example: 'clq8x9z8x0001qh8x9z8x0001',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (1-indexed)',
    example: 1,
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    example: 20,
    type: Number,
  })
  @ApiOkResponse({
    description: 'Paginated list of jobs retrieved successfully',
    type: [CreateJobDto],
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching jobs',
  })
  async findAll(
    @Query('stage') stage?: JobStage,
    @Query('nodeId') nodeId?: string,
    @Query('search') search?: string,
    @Query('libraryId') libraryId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number
  ): Promise<{ jobs: Job[]; total: number; page: number; limit: number; totalPages: number }> {
    // Convert string query params to numbers if present
    const pageNum = page ? Number(page) : undefined;
    const limitNum = limit ? Number(limit) : undefined;
    return this.queueService.findAll(stage, nodeId, search, libraryId, pageNum, limitNum);
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
   * Get preview image for a job
   */
  @Get(':id/preview/:index')
  @ApiOperation({
    summary: 'Get encoding preview image',
    description:
      'Serves a preview screenshot image generated during encoding.\n\n' +
      '**Preview System**:\n' +
      '- Generates 9 preview screenshots at 10%, 20%, 30%, 40%, 50%, 60%, 70%, 80%, 90%\n' +
      '- Updates every 30 seconds during encoding\n' +
      '- Stored in `/tmp/bitbonsai-previews/{jobId}/`\n' +
      '- Automatically cleaned up when job completes/fails\n\n' +
      '**Index Parameter**:\n' +
      '- **1-9**: Preview at 10%, 20%, ..., 90% progress\n\n' +
      '**Use Case**: Display live encoding previews in UI carousel',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiParam({
    name: 'index',
    description: 'Preview image index (1-9)',
    example: '1',
  })
  @ApiOkResponse({
    description: 'Preview image served successfully',
    schema: {
      type: 'string',
      format: 'binary',
    },
  })
  @ApiNotFoundResponse({
    description: 'Job not found or preview image does not exist',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while serving preview',
  })
  async getPreviewImage(
    @Param('id') id: string,
    @Param('index') index: string,
    @Res({ passthrough: false }) res: Response
  ): Promise<void> {
    // Verify job exists
    const job = await this.queueService.findOne(id);

    // Parse and validate preview index
    const previewIndex = parseInt(index, 10);
    if (Number.isNaN(previewIndex) || previewIndex < 1 || previewIndex > 9) {
      throw new NotFoundException(`Invalid preview index. Must be between 1 and 9.`);
    }

    // Parse preview image paths from JSON
    const previewPaths: string[] = job.previewImagePaths ? JSON.parse(job.previewImagePaths) : [];

    // Get the requested preview path (1-indexed to 0-indexed)
    const previewPath = previewPaths[previewIndex - 1];

    // BUGFIX: Return 204 No Content instead of 404 when preview doesn't exist
    // This prevents error spam in logs for jobs with old/stale preview paths
    // Frontend already handles image loading errors gracefully
    if (!previewPath || !existsSync(previewPath)) {
      this.logger.debug(
        `Preview image ${previewIndex} not available for job ${id} (path: ${previewPath || 'undefined'})`
      );
      res.status(204).send();
      return;
    }

    // Serve the image file
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache');

    const fileStream = createReadStream(previewPath);
    fileStream.pipe(res);
  }

  /**
   * Manually capture a preview screenshot at current encoding progress
   */
  @Post(':id/preview/capture')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually capture preview at current progress',
    description:
      'Captures a preview screenshot from the temp file at the current encoding progress.\n\n' +
      '**Use Case**: User clicks "Capture Now" button to get a snapshot of current encoding progress.\n\n' +
      '**Requirements**:\n' +
      '- Job must be in ENCODING stage\n' +
      '- Temp file must exist\n' +
      '- Returns updated job with new preview path added to previewImagePaths array',
  })
  @ApiParam({
    name: 'id',
    description: 'Job unique identifier (CUID)',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  @ApiOkResponse({
    description: 'Preview captured successfully, returns updated job',
  })
  @ApiNotFoundResponse({
    description: 'Job not found',
  })
  @ApiBadRequestResponse({
    description: 'Job is not in ENCODING stage or temp file does not exist',
  })
  async capturePreview(@Param('id') id: string): Promise<Job> {
    const job = await this.queueService.findOne(id);

    // Verify job is in ENCODING stage
    if (job.stage !== JobStage.ENCODING) {
      throw new BadRequestException(
        `Cannot capture preview. Job is in ${job.stage} stage (must be ENCODING)`
      );
    }

    // Verify source file exists
    if (!job.filePath || !existsSync(job.filePath)) {
      throw new BadRequestException('Cannot capture preview. Source file does not exist');
    }

    if (job.progress === null || job.progress === undefined) {
      throw new BadRequestException('Cannot capture preview. Missing progress information');
    }

    // Get duration from source file using ffprobe
    let durationSeconds: number;
    try {
      const { stdout } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          job.filePath,
        ],
        {
          timeout: 5000,
        }
      );
      durationSeconds = parseFloat(stdout.trim());

      if (Number.isNaN(durationSeconds) || durationSeconds <= 0) {
        throw new Error('Invalid duration');
      }
    } catch (error: any) {
      this.logger.error('Failed to get file duration', {
        jobId: job.id,
        filePath: job.filePath,
        error: error?.message,
      });
      throw new BadRequestException('Failed to get file duration for preview capture');
    }

    // Calculate timestamp based on current encoding progress
    // Extract frame from original source file at this timestamp
    const timestampSeconds = (job.progress / 100) * durationSeconds;

    // Generate manual preview path
    const manualPreviewPath = `/tmp/bitbonsai-previews/${job.id}/manual-${Date.now()}.jpg`;

    // Create job preview directory if it doesn't exist
    const jobPreviewDir = `/tmp/bitbonsai-previews/${job.id}`;
    await fs.mkdir(jobPreviewDir, { recursive: true });

    // Extract a frame from the source file at current encoding progress
    // Much more reliable than reading from temp file during encoding
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-y', // Overwrite existing
          '-ss',
          timestampSeconds.toString(), // Seek to current progress position
          '-i',
          job.filePath, // Use original source file
          '-vf',
          'scale=640:-1', // Scale down for fast loading
          '-frames:v',
          '1',
          '-q:v',
          '2', // High quality JPEG
          manualPreviewPath,
        ],
        {
          timeout: 10000, // 10 second timeout (seeking can take time on large files)
        }
      );

      // BUGFIX: Verify file exists before saving path to database
      // This prevents empty placeholders from appearing in the UI
      if (!existsSync(manualPreviewPath)) {
        this.logger.error('Manual preview file not found after FFmpeg extraction', {
          jobId: job.id,
          manualPreviewPath,
          timestampSeconds,
        });
        throw new BadRequestException('Preview file not created. FFmpeg may have failed silently.');
      }

      this.logger.log(
        `Preview captured successfully for job ${job.id} at ${timestampSeconds.toFixed(1)}s (${job.progress}%)`
      );
    } catch (error: any) {
      // Log full error details for debugging
      this.logger.error('Failed to capture preview frame', {
        jobId: job.id,
        sourceFilePath: job.filePath,
        timestampSeconds,
        progress: job.progress,
        duration: durationSeconds,
        manualPreviewPath,
        errorMessage: error?.message,
        errorStderr: error?.stderr,
        errorStdout: error?.stdout,
        errorCode: error?.code,
        fullError: error,
      });

      throw new BadRequestException(
        `Failed to capture preview: ${error?.message || 'Unknown error'}`
      );
    }

    // Update job with new preview path
    const existingPaths: string[] = job.previewImagePaths ? JSON.parse(job.previewImagePaths) : [];

    // Add new manual preview path to existing array
    const updatedPaths = [...existingPaths, manualPreviewPath];

    return await this.queueService.update(job.id, {
      previewImagePaths: JSON.stringify(updatedPaths),
    });
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
  async getJobHistory(@Param('id') id: string) {
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

  /**
   * Recheck a failed job to validate if it's truly failed or completed
   */
  @Post(':id/recheck')
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
