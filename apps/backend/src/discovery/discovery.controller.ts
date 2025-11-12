import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/guards/public.decorator';
import { RegistrationRequestService } from '../nodes/services/registration-request.service';
import { SystemInfoService } from '../nodes/services/system-info.service';
import { PolicySyncService } from '../sync/policy-sync.service';
import { CompletePairingDto } from './dto/complete-pairing.dto';
import { DiscoveredNodeDto } from './dto/discovered-node.dto';
import { PairRequestDto } from './dto/pair-request.dto';
import { PairingStatus, PairResponseDto } from './dto/pair-response.dto';
import { PairingTokenResponseDto } from './dto/pairing-token-response.dto';
import { RequestPairingDto } from './dto/request-pairing.dto';
import { ScanResultDto } from './dto/scan-result.dto';
import { NodeDiscoveryService } from './node-discovery.service';

@ApiTags('discovery')
@ApiBearerAuth('JWT-auth')
@Controller('discovery')
export class DiscoveryController {
  constructor(
    private readonly discoveryService: NodeDiscoveryService,
    private readonly syncService: PolicySyncService,
    private readonly registrationRequestService: RegistrationRequestService,
    private readonly systemInfoService: SystemInfoService
  ) {}

  /**
   * Scan for MAIN nodes on the network
   *
   * Performs a 5-second mDNS scan to discover available MAIN nodes.
   * Used by LINKED nodes during initial setup to find pairing targets.
   */
  @Public()
  @Get('scan')
  @ApiOperation({
    summary: 'Scan for MAIN nodes',
    description:
      'Performs mDNS scan to discover BitBonsai MAIN nodes on the local network.\n\n' +
      '**Use Case**: LINKED node setup - find available MAIN nodes to pair with\n\n' +
      '**Process**:\n' +
      '1. Broadcasts mDNS query for _bitbonsai._tcp.local services\n' +
      '2. Collects responses for 5 seconds\n' +
      '3. Returns list of discovered MAIN nodes with connection details\n\n' +
      '**Response Includes**:\n' +
      '- Node ID and display name\n' +
      '- IP address and API port\n' +
      '- Version information\n' +
      '- Discovery timestamp\n' +
      '- Scan duration\n\n' +
      '**Note**: Only works on local network (mDNS/Bonjour)',
  })
  @ApiOkResponse({
    description: 'Scan completed successfully',
    type: ScanResultDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Scan failed due to network or system error',
  })
  async scanForMainNodes(): Promise<ScanResultDto> {
    const startTime = Date.now();
    const nodes = await this.discoveryService.scanForMainNodes();
    const scanDurationMs = Date.now() - startTime;

    return {
      nodes,
      scanDurationMs,
    };
  }

  /**
   * Initiate pairing with a MAIN node (auto-discovery flow)
   *
   * Creates a registration request and returns the pairing code.
   * The child node displays this code for the user to enter on the main node.
   */
  @Public()
  @Post('pair')
  @ApiOperation({
    summary: 'Initiate pairing with MAIN node',
    description:
      'Initiates pairing process with a discovered MAIN node (auto-discovery flow).\n\n' +
      '**Use Case**: Child node has scanned network and user selected a main node\n\n' +
      '**Process**:\n' +
      '1. Creates registration request on MAIN node\n' +
      '2. Generates 6-digit pairing code (24h expiration)\n' +
      '3. Returns code for user to enter on MAIN node\n' +
      '4. MAIN node admin approves request\n' +
      '5. Child node receives connection token\n\n' +
      '**Response**: Pairing status and code to display to user',
  })
  @ApiOkResponse({
    description: 'Pairing initiated successfully',
    type: PairResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid request or main node unavailable',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to initiate pairing',
  })
  async initiatePairing(@Body() dto: PairRequestDto): Promise<PairResponseDto> {
    try {
      // Get the discovered node from cache to find its URL
      const discoveredNodes = await this.discoveryService.getDiscoveredNodes();
      const mainNode = discoveredNodes.find((n) => n.nodeId === dto.mainNodeId);

      if (!mainNode) {
        return {
          status: PairingStatus.ERROR,
          message: 'MAIN node not found. Please scan again.',
        };
      }

      // Collect system information from THIS node (CHILD node)
      const systemInfo = await this.systemInfoService.collectSystemInfo();

      // Make HTTP request to MAIN node to create registration request
      // Now includes system info from CHILD node
      const mainNodeUrl = `http://${mainNode.ipAddress}:${mainNode.apiPort}`;
      const response = await fetch(`${mainNodeUrl}/api/v1/nodes/registration-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mainNodeId: dto.mainNodeId,
          childNodeName: dto.childNodeName,
          // Include system info from CHILD node
          ipAddress: systemInfo.ipAddress,
          hostname: systemInfo.hostname,
          macAddress: systemInfo.macAddress,
          subnet: systemInfo.subnet,
          containerType: systemInfo.containerType,
          hardwareSpecs: systemInfo.hardwareSpecs,
          acceleration: systemInfo.acceleration,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create registration request on MAIN node');
      }

      const request = await response.json();

      // Return response matching frontend expectations
      return {
        status: PairingStatus.WAITING_APPROVAL,
        requestId: request.id,
        pairingCode: request.pairingToken,
        message: `Pairing code generated. Enter code ${request.pairingToken} on the main node to approve connection.`,
      };
    } catch (error) {
      return {
        status: PairingStatus.ERROR,
        message: error instanceof Error ? error.message : 'Failed to initiate pairing',
      };
    }
  }

  /**
   * Poll pairing status
   *
   * Checks the status of a pairing request to see if it has been approved, rejected, or is still pending.
   */
  @Public()
  @Get('pair/:requestId/status')
  @ApiOperation({
    summary: 'Poll pairing status',
    description:
      'Checks the current status of a pairing request.\n\n' +
      '**Use Case**: Child node polls this endpoint while waiting for MAIN node approval\n\n' +
      '**Response**: Current pairing status and connection token if approved',
  })
  @ApiOkResponse({
    description: 'Pairing status retrieved successfully',
    type: PairResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid request ID',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to check pairing status',
  })
  async getPairingStatus(@Param('requestId') requestId: string): Promise<PairResponseDto> {
    try {
      const request = await this.registrationRequestService.getRequest(requestId);

      // Map registration request status to pairing status
      switch (request.status) {
        case 'PENDING':
          return {
            status: PairingStatus.WAITING_APPROVAL,
            pairingCode: request.pairingToken,
            message: 'Waiting for approval from main node',
          };

        case 'APPROVED':
          // Registration was approved, child node should have been created
          if (!request.childNodeId) {
            return {
              status: PairingStatus.ERROR,
              message: 'Request approved but child node not created',
            };
          }

          // Get the child node to retrieve its API key (connection token)
          // Note: In a real implementation, we'd need a way to securely return this
          // For now, return success without the actual token
          return {
            status: PairingStatus.APPROVED,
            message: 'Pairing approved successfully',
            // TODO: Return actual connection token and main node info
          };

        case 'REJECTED':
          return {
            status: PairingStatus.REJECTED,
            message: request.rejectionReason || 'Pairing request was rejected',
          };

        case 'EXPIRED':
          return {
            status: PairingStatus.TIMEOUT,
            message: 'Pairing code has expired',
          };

        case 'CANCELLED':
          return {
            status: PairingStatus.ERROR,
            message: 'Pairing request was cancelled',
          };

        default:
          return {
            status: PairingStatus.ERROR,
            message: `Unknown status: ${request.status}`,
          };
      }
    } catch (error) {
      return {
        status: PairingStatus.ERROR,
        message: error instanceof Error ? error.message : 'Failed to check pairing status',
      };
    }
  }

  /**
   * Get list of discovered nodes (cached)
   *
   * Returns nodes discovered in the last scan without performing a new scan.
   * Useful for quick lookups without network overhead.
   */
  @Get('discovered-nodes')
  @ApiOperation({
    summary: 'Get discovered nodes (cached)',
    description:
      'Returns list of MAIN nodes discovered in the most recent scan.\n\n' +
      '**Use Case**: Quick lookup of available nodes without re-scanning\n\n' +
      '**Response Includes**:\n' +
      '- All nodes from the last scan\n' +
      '- Empty array if no scan performed yet\n\n' +
      '**Note**: Data is cached in memory - perform new scan for fresh results',
  })
  @ApiOkResponse({
    description: 'Discovered nodes retrieved successfully',
    type: [DiscoveredNodeDto],
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to retrieve discovered nodes',
  })
  async getDiscoveredNodes(): Promise<DiscoveredNodeDto[]> {
    return this.discoveryService.getDiscoveredNodes();
  }

  /**
   * Request pairing with a MAIN node
   *
   * Initiates the pairing process by requesting a pairing token from the MAIN node.
   * The MAIN node generates a 6-digit token valid for 10 minutes.
   */
  @Post('request-pairing')
  @ApiOperation({
    summary: 'Request pairing with MAIN node',
    description:
      'Initiates pairing process with a discovered MAIN node.\n\n' +
      '**Use Case**: LINKED node requests to pair with MAIN node\n\n' +
      '**Process**:\n' +
      '1. LINKED node sends request to MAIN node\n' +
      '2. MAIN node generates 6-digit pairing token\n' +
      '3. Token valid for 10 minutes\n' +
      '4. LINKED node receives token to complete pairing\n\n' +
      '**Next Step**: Use token with /discovery/complete-pairing endpoint',
  })
  @ApiOkResponse({
    description: 'Pairing token generated successfully',
    type: PairingTokenResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid request or MAIN node unavailable',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to request pairing',
  })
  async requestPairing(@Body() dto: RequestPairingDto): Promise<PairingTokenResponseDto> {
    const pairingToken = await this.discoveryService.requestPairing(
      dto.mainNodeUrl,
      dto.mainNodeId
    );

    return {
      pairingToken,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      mainNodeUrl: dto.mainNodeUrl,
    };
  }

  /**
   * Complete pairing with MAIN node
   *
   * Exchanges the pairing token for an API key to authenticate with the MAIN node.
   * After this step, the LINKED node can communicate with the MAIN node.
   */
  @Post('complete-pairing')
  @ApiOperation({
    summary: 'Complete pairing with MAIN node',
    description:
      'Completes pairing by exchanging token for API key.\n\n' +
      '**Use Case**: Final step in LINKED node pairing process\n\n' +
      '**Process**:\n' +
      '1. LINKED node submits 6-digit pairing token\n' +
      '2. MAIN node validates token (must not be expired)\n' +
      '3. MAIN node returns API key for authentication\n' +
      '4. LINKED node stores API key for future requests\n\n' +
      '**Response Includes**:\n' +
      '- Node details\n' +
      '- API key for authentication\n' +
      '- Status and configuration\n\n' +
      '**Security**: Token can only be used once and expires after 10 minutes',
  })
  @ApiOkResponse({
    description: 'Pairing completed successfully',
  })
  @ApiBadRequestResponse({
    description: 'Invalid or expired pairing token',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to complete pairing',
  })
  async completePairing(@Body() dto: CompletePairingDto): Promise<any> {
    return this.discoveryService.completePairing(dto.mainNodeUrl, dto.pairingToken);
  }

  /**
   * Approve a discovered node and trigger automatic sync
   *
   * Approves a node and automatically syncs policies, libraries, and settings.
   * The sync runs in the background with automatic retry on failure.
   */
  @Post('approve/:nodeId')
  @ApiOperation({
    summary: 'Approve discovered node',
    description:
      'Approve a discovered node and trigger automatic configuration sync.\n\n' +
      '**Process**:\n' +
      '1. Approve node in database\n' +
      '2. Automatically trigger policy/library/settings sync\n' +
      '3. Sync runs with retry logic (max 3 attempts)\n' +
      '4. Node is ready to encode within seconds\n\n' +
      '**Note**: Sync runs asynchronously - use GET /sync/:nodeId/status to check progress',
  })
  @ApiOkResponse({
    description: 'Node approved and sync triggered successfully',
  })
  @ApiBadRequestResponse({
    description: 'Invalid node ID',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to approve node',
  })
  async approveNode(@Param('nodeId') nodeId: string): Promise<any> {
    // Approve the node
    const node = await this.discoveryService.approveNode(nodeId);

    // Trigger automatic sync (runs asynchronously)
    // Don't await - let it run in background
    this.syncService.syncToChildNode(nodeId).catch((error) => {
      // Error is already logged by syncService
    });

    return {
      message: 'Node approved successfully. Sync triggered in background.',
      nodeId: node.id,
      nodeName: node.name,
    };
  }

  /**
   * Reject a discovered node
   *
   * Rejects a node and removes it from the discovered nodes list.
   */
  @Post('reject/:nodeId')
  @ApiOperation({
    summary: 'Reject discovered node',
    description:
      'Reject a discovered node and remove from discovery list.\n\n' +
      '**Use Case**: Ignore unwanted nodes on the network\n\n' +
      '**Process**:\n' +
      '1. Remove node from discovered nodes cache\n' +
      '2. Node will not appear in UI until next scan',
  })
  @ApiOkResponse({
    description: 'Node rejected successfully',
  })
  @ApiBadRequestResponse({
    description: 'Invalid node ID',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to reject node',
  })
  async rejectNode(@Param('nodeId') nodeId: string): Promise<any> {
    await this.discoveryService.rejectNode(nodeId);

    return {
      message: 'Node rejected successfully',
      nodeId,
    };
  }
}
