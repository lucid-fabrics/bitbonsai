import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ReceiveLibrariesDto } from './dto/receive-libraries.dto';
import { ReceivePoliciesDto } from './dto/receive-policies.dto';
import { ReceiveSettingsDto } from './dto/receive-settings.dto';
import { SyncResultDto } from './dto/sync-result.dto';
import { SyncStatusDto } from './dto/sync-status.dto';
import { PolicySyncService } from './policy-sync.service';

@ApiTags('sync')
@ApiBearerAuth('JWT-auth')
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: PolicySyncService) {}

  /**
   * Trigger sync to child node (MAIN NODE ENDPOINT)
   *
   * Manually trigger policy/library/settings sync to a child node.
   * This is automatically called when a node is approved, but can
   * also be triggered manually for re-syncing.
   */
  @Post('sync/:nodeId')
  @ApiOperation({
    summary: 'Sync policies/libraries/settings to child node',
    description:
      'Manually trigger configuration sync to a child node.\n\n' +
      '**Use Case**: Re-sync configuration after changes or failed sync\n\n' +
      '**Process**:\n' +
      '1. Collect all policies from main node\n' +
      '2. Collect all libraries from main node\n' +
      '3. Collect settings from main node\n' +
      '4. Send data to child node via HTTP\n' +
      '5. Update sync status in database\n\n' +
      '**Retry Logic**:\n' +
      '- Automatic retry with exponential backoff (1s, 2s, 4s)\n' +
      '- Maximum 3 retry attempts\n' +
      '- Status marked as FAILED if all retries fail',
  })
  @ApiOkResponse({
    description: 'Sync completed successfully',
    type: SyncResultDto,
  })
  @ApiNotFoundResponse({
    description: 'Child node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Sync failed',
  })
  async syncNode(@Param('nodeId') nodeId: string): Promise<SyncResultDto> {
    return this.syncService.syncToChildNode(nodeId);
  }

  /**
   * Get sync status for child node (MAIN NODE ENDPOINT)
   *
   * Check current sync status of a child node.
   */
  @Get('sync/:nodeId/status')
  @ApiOperation({
    summary: 'Get sync status for child node',
    description:
      'Check current sync status of a child node.\n\n' +
      '**Response Includes**:\n' +
      '- Current sync status (PENDING, SYNCING, COMPLETED, FAILED)\n' +
      '- Last sync timestamp\n' +
      '- Retry count\n' +
      '- Error message (if failed)',
  })
  @ApiOkResponse({
    description: 'Sync status retrieved successfully',
    type: SyncStatusDto,
  })
  @ApiNotFoundResponse({
    description: 'Child node not found',
  })
  async getSyncStatus(@Param('nodeId') nodeId: string): Promise<SyncStatusDto> {
    return this.syncService.getSyncStatus(nodeId);
  }

  /**
   * Retry failed sync (MAIN NODE ENDPOINT)
   *
   * Manually retry a failed sync operation.
   */
  @Post('sync/:nodeId/retry')
  @ApiOperation({
    summary: 'Retry failed sync',
    description:
      'Manually retry a failed sync operation.\n\n' +
      '**Use Case**: Retry after fixing network or configuration issues\n\n' +
      '**Process**:\n' +
      '1. Reset retry count to 0\n' +
      '2. Reset status to PENDING\n' +
      '3. Trigger new sync attempt\n' +
      '4. Return sync result',
  })
  @ApiOkResponse({
    description: 'Sync retry initiated successfully',
    type: SyncResultDto,
  })
  @ApiNotFoundResponse({
    description: 'Child node not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Retry failed',
  })
  async retrySyncNode(@Param('nodeId') nodeId: string): Promise<SyncResultDto> {
    return this.syncService.retrySyncNode(nodeId);
  }

  /**
   * Receive policies from main node (CHILD NODE ENDPOINT)
   *
   * Called by main node to send policies to this child node.
   */
  @Post('receive/policies')
  @ApiOperation({
    summary: 'Receive policies from main node',
    description:
      'Child node endpoint to receive synced policies from main node.\n\n' +
      '**Use Case**: Main node pushes policies to child node during sync\n\n' +
      '**Process**:\n' +
      '1. Receive policy list from main node\n' +
      '2. Upsert each policy (create or update)\n' +
      '3. Preserve existing policy IDs (no conflicts)\n' +
      '4. Return success',
  })
  @ApiOkResponse({
    description: 'Policies received and stored successfully',
  })
  @ApiBadRequestResponse({
    description: 'Invalid policy data',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to store policies',
  })
  async receivePolicies(@Body() dto: ReceivePoliciesDto): Promise<void> {
    await this.syncService.receivePolicies(dto.policies);
  }

  /**
   * Receive libraries from main node (CHILD NODE ENDPOINT)
   *
   * Called by main node to send libraries to this child node.
   * Only metadata is synced, no file scanning.
   */
  @Post('receive/libraries')
  @ApiOperation({
    summary: 'Receive libraries from main node',
    description:
      'Child node endpoint to receive synced libraries from main node.\n\n' +
      '**Use Case**: Main node pushes library metadata to child node during sync\n\n' +
      '**Process**:\n' +
      '1. Receive library list from main node\n' +
      '2. Upsert each library (create or update)\n' +
      '3. Only store metadata, do NOT scan files\n' +
      '4. Return success\n\n' +
      '**Note**: Child nodes do not have access to main node filesystem',
  })
  @ApiOkResponse({
    description: 'Libraries received and stored successfully',
  })
  @ApiBadRequestResponse({
    description: 'Invalid library data',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to store libraries',
  })
  async receiveLibraries(@Body() dto: ReceiveLibrariesDto): Promise<void> {
    await this.syncService.receiveLibraries(dto.libraries);
  }

  /**
   * Receive settings from main node (CHILD NODE ENDPOINT)
   *
   * Called by main node to send settings to this child node.
   */
  @Post('receive/settings')
  @ApiOperation({
    summary: 'Receive settings from main node',
    description:
      'Child node endpoint to receive synced settings from main node.\n\n' +
      '**Use Case**: Main node pushes settings to child node during sync\n\n' +
      '**Process**:\n' +
      '1. Receive settings from main node\n' +
      '2. Update local settings\n' +
      '3. Return success',
  })
  @ApiOkResponse({
    description: 'Settings received and updated successfully',
  })
  @ApiBadRequestResponse({
    description: 'Invalid settings data',
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to update settings',
  })
  async receiveSettings(@Body() dto: ReceiveSettingsDto): Promise<void> {
    await this.syncService.receiveSettings(dto);
  }
}
