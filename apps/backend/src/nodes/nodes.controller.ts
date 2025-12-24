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
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/guards/public.decorator';
import { CurrentNodeDto } from './dto/current-node.dto';
import type { HeartbeatDto } from './dto/heartbeat.dto';
import { NodeCapabilitiesDto } from './dto/node-capabilities.dto';
import { NodeRegistrationResponseDto } from './dto/node-registration-response.dto';
import { NodeResponseDto } from './dto/node-response.dto';
import { NodeStatsDto } from './dto/node-stats.dto';
import { OptimalConfigDto } from './dto/optimal-config.dto';
import type { PairNodeDto } from './dto/pair-node.dto';
import type { RegisterNodeDto } from './dto/register-node.dto';
import { ApproveRequestDto } from './dto/registration/approve-request.dto';
import { CreateRegistrationRequestDto } from './dto/registration/create-registration-request.dto';
import { DiscoveredMainNodeDto } from './dto/registration/discovered-main-node.dto';
import { RegistrationRequestResponseDto } from './dto/registration/registration-request-response.dto';
import { RejectRequestDto } from './dto/registration/reject-request.dto';
import type { UpdateNodeDto } from './dto/update-node.dto';
import { NodesService } from './nodes.service';
import { JobAttributionService } from './services/job-attribution.service';
import { NodeCapabilityDetectorService } from './services/node-capability-detector.service';
import { NodeDiscoveryService } from './services/node-discovery.service';
import { RegistrationRequestService } from './services/registration-request.service';
import { SshKeyService } from './services/ssh-key.service';

@ApiTags('nodes')
@ApiBearerAuth('JWT-auth')
@Controller('nodes')
export class NodesController {
  constructor(
    private readonly nodesService: NodesService,
    private readonly nodeDiscoveryService: NodeDiscoveryService,
    private readonly registrationRequestService: RegistrationRequestService,
    private readonly capabilityDetector: NodeCapabilityDetectorService,
    private readonly jobAttribution: JobAttributionService,
    private readonly sshKeyService: SshKeyService
  ) {}

  /**
   * Register a new node
   * SECURITY: Strict rate limiting to prevent abuse
   */
  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // SECURITY: 5 registrations per minute per IP
  @ApiOperation({
    summary: 'Register a new node',
    description:
      'Registers a new BitBonsai node with license validation and pairing mechanism.\n\n' +
      '**Registration Process**:\n' +
      '1. **License Validation**: Validates license key and checks if active\n' +
      '2. **Node Limit Check**: Ensures license node limit not exceeded\n' +
      '3. **Role Assignment**: First node becomes MAIN, additional nodes are LINKED\n' +
      '4. **API Key Generation**: Creates unique API key for node authentication\n' +
      '5. **Pairing Token**: Generates 6-digit code (expires in 10 minutes)\n\n' +
      '**Response**:\n' +
      '- **apiKey**: Save this securely - only shown once during registration\n' +
      '- **pairingToken**: 6-digit code to complete pairing via web UI\n' +
      '- **pairingExpiresAt**: Token expiration timestamp (10 minutes)\n\n' +
      '**Next Steps**:\n' +
      '1. Save the API key in node configuration\n' +
      '2. Complete pairing by entering the 6-digit code in web UI (/nodes/pair)\n' +
      '3. Start sending heartbeats (/nodes/:id/heartbeat)\n\n' +
      '**SECURITY**: Rate limited to 5 registrations per minute to prevent abuse',
  })
  @ApiCreatedResponse({
    description: 'Node registered successfully',
    type: NodeRegistrationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid or inactive license key',
  })
  @ApiConflictResponse({
    description: 'Maximum nodes reached for this license',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred during registration',
  })
  async register(@Body() registerNodeDto: RegisterNodeDto): Promise<NodeRegistrationResponseDto> {
    return this.nodesService.registerNode(registerNodeDto);
  }

  /**
   * Complete node pairing
   * SECURITY: Rate limited to prevent brute force attacks on pairing tokens
   */
  @Post('pair')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // SECURITY: 10 pairing attempts per minute
  @ApiOperation({
    summary: 'Complete node pairing',
    description:
      'Completes the node pairing process using the 6-digit pairing token.\n\n' +
      '**Pairing Process**:\n' +
      '1. User enters 6-digit code displayed on the node into web UI\n' +
      '2. System validates token and checks expiration (10 minute window)\n' +
      '3. Pairing token is cleared (prevents reuse)\n' +
      '4. Node is now fully paired and ready for operation\n\n' +
      '**Token Validation**:\n' +
      '- Token must match exactly (6 digits)\n' +
      '- Token must not be expired (10 minute expiration)\n' +
      '- Token can only be used once\n\n' +
      '**Use Case**: Web UI pairing flow, CLI pairing verification\n\n' +
      '**SECURITY**: Rate limited to 10 attempts per minute to prevent brute force',
  })
  @ApiOkResponse({
    description: 'Node paired successfully',
    type: NodeResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Invalid or expired pairing token',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred during pairing',
  })
  async pair(@Body() pairNodeDto: PairNodeDto): Promise<NodeResponseDto> {
    const node = await this.nodesService.pairNode(pairNodeDto.pairingToken);
    // Exclude sensitive fields
    const { apiKey, pairingToken, pairingExpiresAt, licenseId, ...safeNode } = node;
    return safeNode;
  }

  /**
   * Generate new pairing token for a node
   */
  @Post(':id/pairing-token')
  @ApiOperation({
    summary: 'Generate new pairing token',
    description:
      'Generates a new pairing token for a node if the original token expired.\n\n' +
      '**Use Case**: Original pairing token expired before user completed pairing\n\n' +
      '**Process**:\n' +
      '1. Generates new 6-digit pairing token\n' +
      '2. Sets new 10-minute expiration\n' +
      '3. Returns updated node with new token\n\n' +
      '**Note**: This invalidates any previous pairing token for this node',
  })
  @ApiParam({
    name: 'id',
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'New pairing token generated successfully',
    type: NodeRegistrationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Node already paired or in invalid state',
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while generating token',
  })
  async generatePairingToken(@Param('id') id: string): Promise<NodeRegistrationResponseDto> {
    return this.nodesService.generatePairingTokenForNode(id);
  }

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
    // Exclude sensitive fields
    const { apiKey, pairingToken, pairingExpiresAt, licenseId, ...safeNode } = node;
    return safeNode;
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
    return {
      id: node.id,
      name: node.name,
      role: node.role,
      status: node.status,
      version: node.version,
      acceleration: node.acceleration,
      mainNodeUrl: node.mainNodeUrl,
    };
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
    // Exclude sensitive fields from all nodes
    return nodes.map((node) => {
      const { apiKey, pairingToken, pairingExpiresAt, licenseId, ...safeNode } = node;
      return safeNode;
    });
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
  async getNodeScores() {
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
  async detectEnvironment() {
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
  async getStorageRecommendation(@Body() body: { sourceNodeId: string; targetNodeId: string }) {
    const { EnvironmentDetectorService } = await import(
      '../core/services/environment-detector.service'
    );
    const detector = new EnvironmentDetectorService();

    // Get node info
    const sourceNode = await this.nodesService.findOne(body.sourceNodeId);
    const targetNode = await this.nodesService.findOne(body.targetNodeId);

    // Build node info for recommendation
    const sourceInfo = {
      subnet: sourceNode.networkLocation || null,
      containerType: (sourceNode.containerType as any) || 'UNKNOWN',
      canMountNFS: sourceNode.canMountNFS || false,
    };

    const targetInfo = {
      subnet: targetNode.networkLocation || null,
      containerType: (targetNode.containerType as any) || 'UNKNOWN',
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
    // Exclude sensitive fields
    const { apiKey, pairingToken, pairingExpiresAt, licenseId, ...safeNode } = node;
    return safeNode;
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
    // Exclude sensitive fields
    const { apiKey, pairingToken, pairingExpiresAt, licenseId, ...safeNode } = node;
    return safeNode;
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

  /**
   * Unregister current node from main node
   */
  @Post('unregister-self')
  @ApiOperation({
    summary: 'Unregister current node',
    description:
      'Unregisters the current LINKED node from its MAIN node.\n\n' +
      '**Unregistration Process**:\n' +
      '1. Attempts to notify MAIN node (3 retries, 2s delay)\n' +
      '2. Clears local pairing configuration\n' +
      '3. Resets node to unconfigured state\n\n' +
      '**Response**: After unregistration, redirect to /node-setup to reconfigure\n\n' +
      '**Use Case**: Child node reconfiguration, changing main node',
  })
  @ApiOkResponse({
    description: 'Node unregistered successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Successfully unregistered from main node' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Only LINKED nodes can unregister (MAIN nodes cannot)',
  })
  @ApiNotFoundResponse({
    description: 'Current node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred during unregistration',
  })
  async unregisterSelf(): Promise<{ success: boolean; message: string }> {
    return this.nodesService.unregisterSelf();
  }

  // ============================================================================
  // NODE DISCOVERY & REGISTRATION REQUEST ENDPOINTS
  // ============================================================================

  /**
   * Discover MAIN nodes on the network (for CHILD nodes)
   */
  @Public()
  @Get('discovery/main-nodes')
  @ApiOperation({
    summary: 'Discover MAIN nodes via mDNS',
    description:
      'Discovers available MAIN nodes on the local network using mDNS broadcasting.\n\n' +
      '**Discovery Process**:\n' +
      '1. Broadcasts mDNS query for bitbonsai-main services\n' +
      '2. Listens for responses for 5 seconds\n' +
      '3. Returns list of discovered MAIN nodes with their details\n\n' +
      '**Use Case**: CHILD node startup, user selecting which MAIN node to register with',
  })
  @ApiOkResponse({
    description: 'List of discovered MAIN nodes',
    type: [DiscoveredMainNodeDto],
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred during discovery',
  })
  async discoverMainNodes(): Promise<DiscoveredMainNodeDto[]> {
    return this.nodeDiscoveryService.discoverMainNodes();
  }

  /**
   * Create a registration request (CHILD → MAIN)
   * SECURITY: Rate limited to prevent spam and abuse
   */
  @Public()
  @Post('registration-requests')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // SECURITY: 10 requests per minute
  @ApiOperation({
    summary: 'Send registration request to MAIN node',
    description:
      'Creates a registration request from a CHILD node to a MAIN node.\n\n' +
      '**Registration Process**:\n' +
      '1. Collects system information (IP, hostname, hardware specs)\n' +
      '2. Generates 6-digit pairing token (24h expiration)\n' +
      "3. Sends request to MAIN node's pending queue\n" +
      '4. If duplicate MAC address detected, resets TTL of existing request\n\n' +
      '**Response**: Registration request details including pairing token\n\n' +
      '**Use Case**: Flow 1 - Child-initiated auto-registration\n\n' +
      '**SECURITY**: Rate limited to 10 requests per minute to prevent spam',
  })
  @ApiCreatedResponse({
    description: 'Registration request created successfully',
    type: RegistrationRequestResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid request data',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while creating request',
  })
  async createRegistrationRequest(
    @Body() createDto: CreateRegistrationRequestDto
  ): Promise<RegistrationRequestResponseDto> {
    return this.registrationRequestService.createRegistrationRequest(createDto) as any;
  }

  /**
   * Get pending registration requests for MAIN node
   */
  @Get('registration-requests/pending')
  @ApiOperation({
    summary: 'Get pending registration requests',
    description:
      'Returns all pending registration requests for the current MAIN node.\n\n' +
      '**Filtering**:\n' +
      '- Only returns PENDING requests\n' +
      '- Excludes expired requests\n' +
      '- Ordered by requested date (newest first)\n\n' +
      '**Use Case**: MAIN node pending requests page, notification bell',
  })
  @ApiOkResponse({
    description: 'List of pending registration requests',
    type: [RegistrationRequestResponseDto],
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching requests',
  })
  async getPendingRequests(): Promise<RegistrationRequestResponseDto[]> {
    // Get current node (must be MAIN)
    const currentNode = await this.nodesService.getCurrentNode();
    return this.registrationRequestService.getPendingRequests(currentNode.id) as any;
  }

  /**
   * Get a specific registration request
   */
  @Get('registration-requests/:id')
  @ApiOperation({
    summary: 'Get registration request details',
    description: 'Retrieves detailed information about a specific registration request.',
  })
  @ApiParam({
    name: 'id',
    description: 'Registration request unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Registration request retrieved successfully',
    type: RegistrationRequestResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Registration request not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching request',
  })
  async getRegistrationRequest(@Param('id') id: string): Promise<RegistrationRequestResponseDto> {
    return this.registrationRequestService.getRequest(id) as any;
  }

  /**
   * Approve a registration request
   */
  @Post('registration-requests/:id/approve')
  @ApiOperation({
    summary: 'Approve registration request',
    description:
      'Approves a pending registration request and creates the CHILD node.\n\n' +
      '**Approval Process**:\n' +
      '1. Validates request is PENDING and not expired\n' +
      '2. Checks license node limit\n' +
      '3. Creates CHILD node with specified configuration\n' +
      '4. Updates request status to APPROVED\n' +
      '5. Returns updated request with child node ID\n\n' +
      '**Use Case**: MAIN node administrator approving a pending request',
  })
  @ApiParam({
    name: 'id',
    description: 'Registration request unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Registration request approved successfully',
    type: RegistrationRequestResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Request is not in PENDING state or has expired',
  })
  @ApiConflictResponse({
    description: 'Maximum nodes reached for license',
  })
  @ApiNotFoundResponse({
    description: 'Registration request not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while approving request',
  })
  async approveRegistrationRequest(
    @Param('id') id: string,
    @Body() approveDto?: ApproveRequestDto
  ): Promise<RegistrationRequestResponseDto> {
    return this.registrationRequestService.approveRequest(id, approveDto) as any;
  }

  /**
   * Reject a registration request
   */
  @Post('registration-requests/:id/reject')
  @ApiOperation({
    summary: 'Reject registration request',
    description:
      'Rejects a pending registration request with a reason.\n\n' +
      '**Rejection Process**:\n' +
      '1. Validates request is PENDING\n' +
      '2. Updates request status to REJECTED\n' +
      '3. Stores rejection reason\n\n' +
      '**Use Case**: MAIN node administrator denying an unauthorized device',
  })
  @ApiParam({
    name: 'id',
    description: 'Registration request unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Registration request rejected successfully',
    type: RegistrationRequestResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Request is not in PENDING state',
  })
  @ApiNotFoundResponse({
    description: 'Registration request not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while rejecting request',
  })
  async rejectRegistrationRequest(
    @Param('id') id: string,
    @Body() rejectDto: RejectRequestDto
  ): Promise<RegistrationRequestResponseDto> {
    return this.registrationRequestService.rejectRequest(id, rejectDto) as any;
  }

  /**
   * Cancel a registration request (by ID)
   */
  @Delete('registration-requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel registration request',
    description:
      'Cancels a pending registration request.\n\n' +
      '**Cancellation Process**:\n' +
      '1. Validates request is PENDING\n' +
      '2. Updates request status to CANCELLED\n\n' +
      '**Use Case**: CHILD node user decides to become MAIN instead',
  })
  @ApiParam({
    name: 'id',
    description: 'Registration request unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @ApiOkResponse({
    description: 'Registration request cancelled successfully',
    type: RegistrationRequestResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Request is not in PENDING state',
  })
  @ApiNotFoundResponse({
    description: 'Registration request not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while cancelling request',
  })
  async cancelRegistrationRequest(
    @Param('id') id: string
  ): Promise<RegistrationRequestResponseDto> {
    return this.registrationRequestService.cancelRequest(id) as any;
  }

  /**
   * Cancel a registration request (by pairing token)
   */
  @Public()
  @Delete('registration-requests/token/:token/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel registration request by token',
    description:
      'Cancels a pending registration request using the pairing token.\n\n' +
      "**Use Case**: CHILD node cancellation when user doesn't have request ID",
  })
  @ApiParam({
    name: 'token',
    description: '6-digit pairing token',
    example: '123456',
  })
  @ApiOkResponse({
    description: 'Registration request cancelled successfully',
    type: RegistrationRequestResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Request is not in PENDING state or token has expired',
  })
  @ApiNotFoundResponse({
    description: 'Invalid pairing token',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while cancelling request',
  })
  async cancelRegistrationRequestByToken(
    @Param('token') token: string
  ): Promise<RegistrationRequestResponseDto> {
    return this.registrationRequestService.cancelRequestByToken(token) as any;
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
        } catch (_error) {
          // Silent fallback to localhost
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
  async clearScoreCache() {
    this.jobAttribution.clearCache();
    return {
      success: true,
      message: 'Score cache cleared',
    };
  }

  // ============================================================================
  // STORAGE CONFIGURATION & ENVIRONMENT DETECTION ENDPOINTS
  // ============================================================================

  // ============================================================================
  // SSH KEY MANAGEMENT ENDPOINTS
  // ============================================================================

  /**
   * Get this node's SSH public key
   */
  @Public()
  @Get('ssh/public-key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get this node's SSH public key",
    description:
      'Returns the SSH public key for this node. Used during node registration to enable passwordless file transfers.',
  })
  @ApiOkResponse({
    description: 'SSH public key retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        publicKey: {
          type: 'string',
          example: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC... bitbonsai-cluster-node',
        },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'SSH public key not found or not generated yet',
  })
  async getSshPublicKey() {
    const publicKey = this.sshKeyService.getPublicKey();
    return { publicKey };
  }

  /**
   * Add an authorized SSH key
   */
  @Public()
  @Post('ssh/authorized-keys')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add an authorized SSH key',
    description:
      "Adds a remote SSH public key to this node's authorized_keys file. " +
      'Used after node approval to enable passwordless file transfers from the main node.',
  })
  @ApiOkResponse({
    description: 'SSH key added successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'SSH key added to authorized_keys' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid SSH public key format',
  })
  async addAuthorizedKey(@Body() body: { publicKey: string; comment?: string }) {
    this.sshKeyService.addAuthorizedKey(body.publicKey, body.comment);
    return {
      success: true,
      message: 'SSH key added to authorized_keys',
    };
  }
}
