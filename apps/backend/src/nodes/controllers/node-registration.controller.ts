import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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
import { Public } from '../../auth/guards/public.decorator';
import { NodeRegistrationResponseDto } from '../dto/node-registration-response.dto';
import { NodeResponseDto } from '../dto/node-response.dto';
import type { PairNodeDto } from '../dto/pair-node.dto';
import type { RegisterNodeDto } from '../dto/register-node.dto';
import { ApproveRequestDto } from '../dto/registration/approve-request.dto';
import { CreateRegistrationRequestDto } from '../dto/registration/create-registration-request.dto';
import { DiscoveredMainNodeDto } from '../dto/registration/discovered-main-node.dto';
import { RegistrationRequestResponseDto } from '../dto/registration/registration-request-response.dto';
import { RejectRequestDto } from '../dto/registration/reject-request.dto';
import { NodesService } from '../nodes.service';
import { NodeDiscoveryService } from '../services/node-discovery.service';
import { RegistrationRequestService } from '../services/registration-request.service';
import { SshKeyService } from '../services/ssh-key.service';
import {
  toNodeResponseDto,
  toRegistrationRequestResponseDto,
  toRegistrationRequestResponseDtoArray,
} from '../utils/node.mapper';

@ApiTags('nodes')
@ApiBearerAuth('JWT-auth')
@Controller('nodes')
export class NodeRegistrationController {
  constructor(
    private readonly nodesService: NodesService,
    private readonly nodeDiscoveryService: NodeDiscoveryService,
    private readonly registrationRequestService: RegistrationRequestService,
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
    return toNodeResponseDto(node);
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
    const request = await this.registrationRequestService.createRegistrationRequest(createDto);
    return toRegistrationRequestResponseDto(request);
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
    const currentNode = await this.nodesService.getCurrentNode();
    const requests = await this.registrationRequestService.getPendingRequests(currentNode.id);
    return toRegistrationRequestResponseDtoArray(requests);
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
    const request = await this.registrationRequestService.getRequest(id);
    return toRegistrationRequestResponseDto(request);
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
    const request = await this.registrationRequestService.approveRequest(id, approveDto);
    return toRegistrationRequestResponseDto(request);
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
    const request = await this.registrationRequestService.rejectRequest(id, rejectDto);
    return toRegistrationRequestResponseDto(request);
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
    const request = await this.registrationRequestService.cancelRequest(id);
    return toRegistrationRequestResponseDto(request);
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
    const request = await this.registrationRequestService.cancelRequestByToken(token);
    return toRegistrationRequestResponseDto(request);
  }

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
  async getSshPublicKey(): Promise<{ publicKey: string | null }> {
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
  async addAuthorizedKey(
    @Body() body: { publicKey: string; comment?: string }
  ): Promise<{ success: boolean; message: string }> {
    this.sshKeyService.addAuthorizedKey(body.publicKey, body.comment);
    return {
      success: true,
      message: 'SSH key added to authorized_keys',
    };
  }
}
