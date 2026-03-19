import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/guards/public.decorator';
import { CurrentNodeDto } from './dto/current-node.dto';
import type { HeartbeatDto } from './dto/heartbeat.dto';
import { NodeResponseDto } from './dto/node-response.dto';
import { NodeStatsDto } from './dto/node-stats.dto';
import { OptimalConfigDto } from './dto/optimal-config.dto';
import type { UpdateNodeDto } from './dto/update-node.dto';
import { NodesService } from './nodes.service';
import { JobAttributionService, type NodeScore } from './services/job-attribution.service';
import { NodeCapabilityDetectorService } from './services/node-capability-detector.service';
import { toCurrentNodeDto, toNodeResponseDto, toNodeResponseDtoArray } from './utils/node.mapper';

@ApiTags('nodes')
@ApiBearerAuth('JWT-auth')
@Controller('nodes')
export class NodesController {
  private readonly logger = new Logger(NodesController.name);

  constructor(
    private readonly nodesService: NodesService,
    private readonly capabilityDetector: NodeCapabilityDetectorService,
    private readonly jobAttribution: JobAttributionService
  ) {}

  /**
   * Record node heartbeat
   */
  @Post(':id/heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record node heartbeat',
    description:
      'Updates node heartbeat and operational status.\n\n' +
      '**Heartbeat Process**:\n' +
      '1. **Update Timestamp**: Records current time as lastHeartbeat\n' +
      '2. **Increment Uptime**: Adds 60 seconds to uptimeSeconds (assumes 60s interval)\n' +
      '3. **Update Status**: Sets status to ONLINE or provided value\n' +
      '4. **Optional Metrics**: Can include CPU/memory usage, active jobs\n\n' +
      '**Recommended Interval**: 60 seconds\n\n' +
      '**Monitoring**: Nodes with lastHeartbeat > 2 minutes old should be marked OFFLINE\n\n' +
      '**Use Case**: Node health monitoring, uptime tracking, cluster management',
  })
  @ApiParam({
    name: 'id',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Heartbeat recorded successfully',
    type: NodeResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid heartbeat data provided',
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while recording heartbeat',
  })
  async heartbeat(
    @Param('id') id: string,
    @Body() heartbeatDto?: HeartbeatDto
  ): Promise<NodeResponseDto> {
    const node = await this.nodesService.heartbeat(id, heartbeatDto);
    return toNodeResponseDto(node);
  }

  /**
   * Get current node information
   */
  @Public()
  @Get('current')
  @ApiOperation({
    summary: 'Get current node information',
    description:
      'Returns information about the currently running node instance.\n\n' +
      '**Node Identification**:\n' +
      '- If NODE_ID environment variable is set, returns that node\n' +
      '- Otherwise, returns the MAIN node (first registered node)\n\n' +
      '**Response Includes**:\n' +
      '- Node ID, name, role, and status\n' +
      '- Version and acceleration type\n\n' +
      '**Use Case**: Frontend determines UI restrictions based on node role\n' +
      '- MAIN nodes can access all pages\n' +
      '- LINKED nodes have restricted UI access',
  })
  @ApiOkResponse({
    description: 'Current node information retrieved successfully',
    type: CurrentNodeDto,
  })
  @ApiNotFoundResponse({
    description: 'No nodes registered or NODE_ID is invalid',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching current node',
  })
  async getCurrentNode(): Promise<CurrentNodeDto> {
    const node = await this.nodesService.getCurrentNode();
    return toCurrentNodeDto(node);
  }

  /**
   * Get all nodes
   */
  @Get()
  @ApiOperation({
    summary: 'List all nodes',
    description:
      'Returns all registered nodes in the cluster.\n\n' +
      '**Response Includes**:\n' +
      '- Basic node information (name, role, status)\n' +
      '- Version and acceleration type\n' +
      '- Last heartbeat timestamp\n' +
      '- Total uptime in seconds\n\n' +
      '**Ordering**: MAIN nodes first, then LINKED nodes, ordered by creation time\n\n' +
      '**Use Case**: Cluster overview, node management dashboard',
  })
  @ApiOkResponse({
    description: 'List of all nodes retrieved successfully',
    type: [NodeResponseDto],
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching nodes',
  })
  async findAll(): Promise<NodeResponseDto[]> {
    const nodes = await this.nodesService.findAll();
    return toNodeResponseDtoArray(nodes);
  }

  /**
   * Get node scores for job attribution
   * IMPORTANT: This route must come BEFORE @Get(':id') to avoid routing conflicts
   */
  @Get('scores')
  @ApiOperation({
    summary: 'Get node scores',
    description:
      'Returns weighted scores for all online nodes used in job attribution algorithm.\n\n' +
      '**Score Breakdown** (100 points total):\n' +
      '- **Schedule Availability**: Binary gate (0 = outside schedule, proceed otherwise)\n' +
      '- **Load Score** (40 pts): Based on active jobs vs maxWorkers\n' +
      '- **Hardware Score** (30 pts): GPU presence + CPU cores\n' +
      '- **Performance Score** (30 pts): Average encoding speed (FPS)\n\n' +
      '**Use Case**: Visualization of node capacity, debugging job distribution',
  })
  @ApiOkResponse({
    description: 'Node scores retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' },
          nodeName: { type: 'string' },
          totalScore: { type: 'number' },
          breakdown: {
            type: 'object',
            properties: {
              scheduleAvailable: { type: 'boolean' },
              loadScore: { type: 'number' },
              hardwareScore: { type: 'number' },
              performanceScore: { type: 'number' },
            },
          },
        },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while calculating scores',
  })
  async getNodeScores(): Promise<NodeScore[]> {
    return this.jobAttribution.getAllNodeScores();
  }

  /**
   * Detect environment information for current node
   * IMPORTANT: This route must come BEFORE @Get(':id') to avoid routing conflicts
   */
  @Get('environment')
  @ApiOperation({
    summary: 'Detect current node environment',
    description:
      'Detects container type, privileges, and NFS mounting capabilities for the current node.\n\n' +
      '**Returns**: Environment info including container type, privilege level, and storage recommendations',
  })
  @ApiOkResponse({
    description: 'Environment information',
    schema: {
      type: 'object',
      properties: {
        containerType: {
          type: 'string',
          enum: ['BARE_METAL', 'LXC', 'DOCKER', 'KUBERNETES', 'UNKNOWN'],
        },
        isPrivileged: { type: 'boolean' },
        canMountNFS: { type: 'boolean' },
        networkSubnet: { type: 'string', nullable: true },
        hostname: { type: 'string' },
      },
    },
  })
  async detectEnvironment(): Promise<unknown> {
    const { EnvironmentDetectorService } = await import(
      '../core/services/environment-detector.service'
    );
    const detector = new EnvironmentDetectorService();
    return detector.detectEnvironment();
  }

  /**
   * Get storage method recommendation between two nodes
   * IMPORTANT: This route must come BEFORE @Get(':id') to avoid routing conflicts
   */
  @Post('storage-recommendation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get storage method recommendation',
    description:
      'Analyzes two nodes and recommends optimal storage sharing method (NFS or rsync).\n\n' +
      '**Factors**: Network location, container type, mount capabilities, privileges.\n\n' +
      '**Returns**: Recommendation with reasoning and any warnings/actions required.',
  })
  @ApiOkResponse({
    description: 'Storage method recommendation',
    schema: {
      type: 'object',
      properties: {
        recommended: { type: 'string', enum: ['NFS', 'RSYNC', 'EITHER'] },
        reason: { type: 'string' },
        warning: { type: 'string' },
        actionRequired: { type: 'string' },
      },
    },
  })
  async getStorageRecommendation(
    @Body() body: { sourceNodeId: string; targetNodeId: string }
  ): Promise<unknown> {
    const { EnvironmentDetectorService, ContainerType } = await import(
      '../core/services/environment-detector.service'
    );
    const detector = new EnvironmentDetectorService();

    // Get node info
    const sourceNode = await this.nodesService.findOne(body.sourceNodeId);
    const targetNode = await this.nodesService.findOne(body.targetNodeId);

    // Map NetworkLocation enum to string for subnet
    const sourceSubnet = sourceNode.networkLocation ? String(sourceNode.networkLocation) : null;
    const targetSubnet = targetNode.networkLocation ? String(targetNode.networkLocation) : null;

    // Prisma ContainerType enum values match EnvironmentDetector ContainerType
    const containerValues = Object.values(ContainerType) as string[];
    const toContainerType = (val: string | null) =>
      val && containerValues.includes(val)
        ? (val as (typeof ContainerType)[keyof typeof ContainerType])
        : ContainerType.UNKNOWN;

    const sourceInfo = {
      subnet: sourceSubnet,
      containerType: toContainerType(sourceNode.containerType),
      canMountNFS: sourceNode.canMountNFS || false,
    };

    const targetInfo = {
      subnet: targetSubnet,
      containerType: toContainerType(targetNode.containerType),
      canMountNFS: targetNode.canMountNFS || false,
    };

    return detector.recommendStorageMethod(sourceInfo, targetInfo);
  }

  /**
   * Get a specific node by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get node details',
    description:
      'Retrieves detailed information about a specific node.\n\n' +
      '**Response Includes**:\n' +
      '- Complete node information\n' +
      '- Excludes sensitive fields (apiKey, pairingToken) for security\n\n' +
      '**Use Case**: Node detail page, configuration review',
  })
  @ApiParam({
    name: 'id',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Node retrieved successfully',
    type: NodeResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching node',
  })
  async findOne(@Param('id') id: string): Promise<NodeResponseDto> {
    const node = await this.nodesService.findOne(id);
    return toNodeResponseDto(node);
  }

  /**
   * Get node statistics
   */
  @Get(':id/stats')
  @ApiOperation({
    summary: 'Get node statistics',
    description:
      'Retrieves comprehensive statistics for a node.\n\n' +
      '**Statistics Include**:\n' +
      '- **License Info**: Tier, max concurrent jobs, node limits\n' +
      '- **Libraries**: List of managed libraries with file counts and sizes\n' +
      '- **Active Jobs**: Count of jobs in QUEUED, ENCODING, or VERIFYING stages\n' +
      '- **Uptime**: Total uptime in seconds since registration\n\n' +
      '**Use Case**: Dashboard metrics, node monitoring, capacity planning',
  })
  @ApiParam({
    name: 'id',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Node statistics retrieved successfully',
    type: NodeStatsDto,
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching statistics',
  })
  async getStats(@Param('id') id: string): Promise<NodeStatsDto> {
    return this.nodesService.getNodeStats(id);
  }

  /**
   * Get recommended optimal configuration for a node
   */
  @Get(':id/recommended-config')
  @ApiOperation({
    summary: 'Get recommended optimal configuration',
    description:
      'Analyzes node hardware and returns recommended maxWorkers setting.\n\n' +
      '**Analysis Based On**:\n' +
      '- CPU core count\n' +
      '- Hardware acceleration type (CPU, NVIDIA, Intel QSV, etc.)\n' +
      '- Optimal cores-per-job allocation\n\n' +
      '**Recommendation Strategy**:\n' +
      '- **CPU encoding**: 6-8 cores per job (CPU-intensive)\n' +
      '- **GPU encoding**: 2 cores per job (GPU does heavy lifting)\n' +
      '- Reserves cores for system overhead\n\n' +
      '**Use Case**: Auto-configure nodes, troubleshoot overload issues',
  })
  @ApiParam({
    name: 'id',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Optimal configuration calculated successfully',
    type: OptimalConfigDto,
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while calculating optimal configuration',
  })
  async getRecommendedConfig(@Param('id') id: string): Promise<OptimalConfigDto> {
    return this.nodesService.getRecommendedConfig(id);
  }

  /**
   * Update a node's configuration
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update node configuration',
    description:
      'Updates node configuration including worker count and CPU limits.\n\n' +
      '**Configurable Settings**:\n' +
      '- **maxWorkers** (1-10): Number of concurrent encoding jobs\n' +
      '- **cpuLimit** (10-100): Maximum CPU usage percentage\n' +
      '- **name**: Display name for the node\n\n' +
      '**Use Case**: Adjusting node capacity, optimizing resource usage',
  })
  @ApiParam({
    name: 'id',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Node updated successfully',
    type: NodeResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid update data',
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while updating node',
  })
  async update(
    @Param('id') id: string,
    @Body() updateNodeDto: UpdateNodeDto
  ): Promise<NodeResponseDto> {
    const node = await this.nodesService.update(id, updateNodeDto);
    return toNodeResponseDto(node);
  }

  /**
   * Delete a node
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a node',
    description:
      'Permanently removes a node from the system.\n\n' +
      '**Warning**: This action:\n' +
      '- **Deletes all associated libraries** (CASCADE)\n' +
      '- **Deletes all associated jobs** (CASCADE)\n' +
      '- **Frees up a license slot** (allows registering a new node)\n' +
      '- **Cannot be undone**\n\n' +
      '**Use Case**: Decommissioning nodes, cleanup after hardware failure',
  })
  @ApiParam({
    name: 'id',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Node deleted successfully (returns 204 No Content)',
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while deleting node',
  })
  async remove(@Param('id') id: string): Promise<void> {
    return this.nodesService.remove(id);
  }

  // ============================================================================
  // NODE CAPABILITY TESTING ENDPOINTS
  // ============================================================================

  /**
   * Test node capabilities (run capability detection)
   */
  @Post(':id/test-capabilities')
  @ApiOperation({
    summary: 'Test node capabilities',
    description:
      'Runs comprehensive capability detection for a node:\n\n' +
      '- Network location detection (LOCAL vs REMOTE)\n' +
      '- Shared storage access test\n' +
      '- Network latency measurement\n' +
      '- Bandwidth test (optional)\n\n' +
      '**Use Case**: Re-run capability tests after network changes, troubleshooting',
  })
  @ApiParam({
    name: 'id',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Capability test results',
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error during capability test',
  })
  async testNodeCapabilities(@Param('id') id: string): Promise<Record<string, unknown>> {
    const node = await this.nodesService.findOne(id);

    // Get IP address: prefer stored ipAddress, then extract from URLs, fallback to localhost
    let nodeIp = node.ipAddress || '127.0.0.1';

    // If no stored IP, try extracting from URLs
    if (!node.ipAddress) {
      const urlToUse = node.publicUrl || node.mainNodeUrl;
      if (urlToUse) {
        try {
          const url = new URL(urlToUse);
          nodeIp = url.hostname;
        } catch (error: unknown) {
          this.logger.warn(
            `Failed to parse node URL "${urlToUse}", falling back to localhost: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    const result = await this.capabilityDetector.detectCapabilities(id, nodeIp);

    // Build test results with all phases
    const tests = {
      networkConnection: {
        status: 'success' as const,
        message: `Latency: ${result.latencyMs}ms`,
        details: { latencyMs: result.latencyMs, isPrivateIP: result.isPrivateIP },
      },
      sharedStorage: {
        status: result.hasSharedStorage ? ('success' as const) : ('warning' as const),
        message: result.hasSharedStorage
          ? `Accessible at ${result.storageBasePath}`
          : 'No shared storage access',
        details: {
          hasSharedStorage: result.hasSharedStorage,
          storageBasePath: result.storageBasePath,
        },
      },
      hardwareDetection: {
        status: 'success' as const,
        message: `Detected ${node.cpuCores || 'unknown'} cores, ${node.ramGB || 'unknown'}GB RAM`,
        details: { cpuCores: node.cpuCores, ramGB: node.ramGB },
      },
      networkType: {
        status: 'success' as const,
        message: `Classified as ${result.networkLocation}`,
        details: { networkLocation: result.networkLocation },
      },
    };

    return {
      nodeId: id,
      nodeName: node.name,
      ...result,
      tests,
    };
  }

  /**
   * Get node capabilities summary
   */
  @Get(':id/capabilities')
  @ApiOperation({
    summary: 'Get node capabilities',
    description: 'Returns current capability configuration for a node',
  })
  @ApiParam({
    name: 'id',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Node capabilities',
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  async getNodeCapabilities(@Param('id') id: string): Promise<Record<string, unknown>> {
    const node = await this.nodesService.findOne(id);

    return {
      nodeId: node.id,
      nodeName: node.name,
      networkLocation: node.networkLocation,
      hasSharedStorage: node.hasSharedStorage,
      storageBasePath: node.storageBasePath,
      latencyMs: node.latencyMs,
      bandwidthMbps: node.bandwidthMbps,
      cpuCores: node.cpuCores,
      ramGB: node.ramGB,
      maxTransferSizeMB: node.maxTransferSizeMB,
      lastSpeedTest: node.lastSpeedTest,
      reasoning: `Network: ${node.networkLocation}, Storage: ${node.hasSharedStorage ? 'Shared' : 'Transfer required'}`,
    };
  }

  // ============================================================================
  // JOB ATTRIBUTION & SCHEDULING ENDPOINTS
  // ============================================================================

  /**
   * Clear node score cache
   */
  @Post('scores/clear-cache')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear node score cache',
    description:
      'Clears the node score cache to force recalculation on next request.\n\n' +
      '**Use Case**: After node configuration changes (maxWorkers, schedule, etc.)',
  })
  @ApiOkResponse({
    description: 'Cache cleared successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Score cache cleared' },
      },
    },
  })
  async clearScoreCache(): Promise<{ success: boolean; message: string }> {
    this.jobAttribution.clearCache();
    return {
      success: true,
      message: 'Score cache cleared',
    };
  }

  // ============================================================================
  // STORAGE CONFIGURATION & ENVIRONMENT DETECTION ENDPOINTS
  // ============================================================================
}
