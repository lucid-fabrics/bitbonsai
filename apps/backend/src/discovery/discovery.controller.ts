import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PolicySyncService } from '../sync/policy-sync.service';
import { CompletePairingDto } from './dto/complete-pairing.dto';
import { DiscoveredNodeDto } from './dto/discovered-node.dto';
import { PairingTokenResponseDto } from './dto/pairing-token-response.dto';
import { RequestPairingDto } from './dto/request-pairing.dto';
import { NodeDiscoveryService } from './node-discovery.service';

@ApiTags('discovery')
@ApiBearerAuth('JWT-auth')
@Controller('discovery')
export class DiscoveryController {
  constructor(
    private readonly discoveryService: NodeDiscoveryService,
    private readonly syncService: PolicySyncService
  ) {}

  /**
   * Scan for MAIN nodes on the network
   *
   * Performs a 5-second mDNS scan to discover available MAIN nodes.
   * Used by LINKED nodes during initial setup to find pairing targets.
   */
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
      '- Discovery timestamp\n\n' +
      '**Note**: Only works on local network (mDNS/Bonjour)',
  })
  @ApiOkResponse({
    description: 'Scan completed successfully',
    type: [DiscoveredNodeDto],
  })
  @ApiInternalServerErrorResponse({
    description: 'Scan failed due to network or system error',
  })
  async scanForMainNodes(): Promise<DiscoveredNodeDto[]> {
    return this.discoveryService.scanForMainNodes();
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
