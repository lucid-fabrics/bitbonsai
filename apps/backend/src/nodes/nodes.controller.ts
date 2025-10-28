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
import { Public } from '../auth/guards/public.decorator';
import { CurrentNodeDto } from './dto/current-node.dto';
import type { HeartbeatDto } from './dto/heartbeat.dto';
import { NodeRegistrationResponseDto } from './dto/node-registration-response.dto';
import { NodeResponseDto } from './dto/node-response.dto';
import { NodeStatsDto } from './dto/node-stats.dto';
import type { PairNodeDto } from './dto/pair-node.dto';
import type { RegisterNodeDto } from './dto/register-node.dto';
import type { UpdateNodeDto } from './dto/update-node.dto';
import { NodesService } from './nodes.service';

@ApiTags('nodes')
@ApiBearerAuth('JWT-auth')
@Controller('nodes')
export class NodesController {
  constructor(private readonly nodesService: NodesService) {}

  /**
   * Register a new node
   */
  @Public()
  @Post('register')
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
      '3. Start sending heartbeats (/nodes/:id/heartbeat)',
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
   */
  @Post('pair')
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
      '**Use Case**: Web UI pairing flow, CLI pairing verification',
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
}
