import { HttpService } from '@nestjs/axios';
import { BadRequestException, Controller, Get, Logger, Param, Query } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { type Job, JobStage } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { NodeConfigService } from '../../core/services/node-config.service';
import { JobStatsDto } from '../dto/job-stats.dto';
import { QueueService } from '../queue.service';

@ApiTags('queue')
@Controller('queue')
export class JobMetricsController {
  private readonly logger = new Logger(JobMetricsController.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly nodeConfig: NodeConfigService,
    private readonly httpService: HttpService
  ) {}

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
    type: [Object],
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
    // LINKED nodes should proxy queue data from MAIN node
    const mainApiUrl = this.nodeConfig.getMainApiUrl();
    if (mainApiUrl) {
      this.logger.debug(`Proxying queue request to main node: ${mainApiUrl}`);

      // Build query params
      const params: Record<string, string> = {};
      if (stage) params.stage = stage;
      if (nodeId) params.nodeId = nodeId;
      if (search) params.search = search;
      if (libraryId) params.libraryId = libraryId;
      if (page) params.page = page.toString();
      if (limit) params.limit = limit.toString();

      try {
        const response = await firstValueFrom(
          this.httpService.get(`${mainApiUrl}/api/v1/queue`, { params })
        );
        return response.data;
      } catch (error: unknown) {
        this.logger.error('Failed to proxy queue request to main node', error);
        throw new BadRequestException('Failed to fetch queue data from main node');
      }
    }

    // MAIN nodes query their own database
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
    type: Object,
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching next job',
  })
  async getNextJob(@Param('nodeId') nodeId: string): Promise<Job | null> {
    this.logger.log(`🔍 MULTI-NODE: Received getNextJob request for nodeId: ${nodeId}`);
    const job = await this.queueService.getNextJob(nodeId);

    if (job) {
      this.logger.log(
        `✅ MULTI-NODE: Returning job ${job.id} (${job.fileLabel}) to node ${nodeId}`
      );
    } else {
      this.logger.debug(`🔍 MULTI-NODE: No jobs available for node ${nodeId}`);
    }

    return job;
  }

  /**
   * Get next job for a node (query parameter variant for LINKED nodes)
   */
  @Get('next-job')
  @ApiOperation({
    summary: 'Get next available job for a node (LINKED node variant)',
    description:
      'Returns the next job in the queue for a specific node to process.\n\n' +
      'This endpoint is identical to GET /queue/next/:nodeId but uses a query parameter\n' +
      'instead of a path parameter for easier consumption by LINKED nodes.\n\n' +
      '**Use Case**: LINKED nodes call this via DataAccessService to fetch work from MAIN node',
  })
  @ApiQuery({
    name: 'nodeId',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Next job retrieved and started, or null if none available',
    type: Object,
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching next job',
  })
  async getNextJobByQuery(@Query('nodeId') nodeId: string): Promise<Job | null> {
    return this.queueService.getNextJob(nodeId);
  }
}
