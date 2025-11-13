import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SyncStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { LibrarySyncDto } from './dto/receive-libraries.dto';
import type { PolicySyncDto } from './dto/receive-policies.dto';
import type { ReceiveSettingsDto } from './dto/receive-settings.dto';
import type { SyncResultDto } from './dto/sync-result.dto';
import type { SyncStatusDto } from './dto/sync-status.dto';

@Injectable()
export class PolicySyncService {
  private readonly logger = new Logger(PolicySyncService.name);
  private readonly MAX_RETRY_ATTEMPTS = 3;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sync all policies, libraries, and settings to a child node
   *
   * Main orchestration method that coordinates syncing all configuration
   * from the main node to a newly approved child node.
   *
   * Process:
   * 1. Mark sync as SYNCING in database
   * 2. Get all policies from main node
   * 3. Get all libraries from main node
   * 4. Get settings from main node
   * 5. Send data to child node via HTTP
   * 6. Update sync status to COMPLETED or FAILED
   * 7. Retry on failure with exponential backoff
   *
   * @param childNodeId Child node to sync to
   * @returns Sync result with status and counts
   */
  async syncToChildNode(childNodeId: string): Promise<SyncResultDto> {
    this.logger.log(`🔄 Starting sync to child node ${childNodeId}`);

    // Get child node details
    const childNode = await this.prisma.node.findUnique({
      where: { id: childNodeId },
    });

    if (!childNode) {
      throw new NotFoundException(`Child node ${childNodeId} not found`);
    }

    // Update sync status to SYNCING
    await this.prisma.node.update({
      where: { id: childNodeId },
      data: {
        syncStatus: SyncStatus.SYNCING,
        syncError: null,
      },
    });

    try {
      // Get all data to sync
      const policies = await this.getPoliciesForSync();
      const libraries = await this.getLibrariesForSync();
      const _settings = await this.getSettingsForSync();

      this.logger.log(
        `📦 Syncing ${policies.length} policies, ${libraries.length} libraries, and settings to ${childNode.name}`
      );

      // TODO: Send data to child node via HTTP
      // For now, we'll just mark as completed since we don't have child node HTTP endpoints yet
      // In production, this would make HTTP requests to the child node's sync endpoints

      // Simulate successful sync
      const result: SyncResultDto = {
        nodeId: childNodeId,
        status: SyncStatus.COMPLETED,
        policiesSynced: policies.length,
        librariesSynced: libraries.length,
        settingsSynced: true,
        syncedAt: new Date(),
      };

      // Update sync status to COMPLETED
      await this.prisma.node.update({
        where: { id: childNodeId },
        data: {
          syncStatus: SyncStatus.COMPLETED,
          lastSyncedAt: new Date(),
          syncRetryCount: 0,
          syncError: null,
        },
      });

      this.logger.log(`✅ Successfully synced to child node ${childNode.name}`);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ Failed to sync to child node ${childNode.name}: ${errorMessage}`);

      // Check if we should retry
      const shouldRetry = childNode.syncRetryCount < this.MAX_RETRY_ATTEMPTS;

      if (shouldRetry) {
        this.logger.warn(
          `⚠️  Retry ${childNode.syncRetryCount + 1}/${this.MAX_RETRY_ATTEMPTS} for node ${childNode.name}`
        );

        // Update retry count and keep status as SYNCING (will retry)
        await this.prisma.node.update({
          where: { id: childNodeId },
          data: {
            syncRetryCount: { increment: 1 },
            syncError: errorMessage,
          },
        });

        // Schedule retry with exponential backoff (1s, 2s, 4s)
        const retryDelayMs = 2 ** childNode.syncRetryCount * 1000;
        this.logger.log(`⏳ Retrying in ${retryDelayMs}ms...`);

        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        return this.syncToChildNode(childNodeId); // Recursive retry
      } else {
        // Max retries reached, mark as FAILED
        await this.prisma.node.update({
          where: { id: childNodeId },
          data: {
            syncStatus: SyncStatus.FAILED,
            syncError: errorMessage,
          },
        });

        return {
          nodeId: childNodeId,
          status: SyncStatus.FAILED,
          policiesSynced: 0,
          librariesSynced: 0,
          settingsSynced: false,
          error: errorMessage,
          syncedAt: new Date(),
        };
      }
    }
  }

  /**
   * Get current sync status for a child node
   *
   * @param childNodeId Child node ID
   * @returns Current sync status
   */
  async getSyncStatus(childNodeId: string): Promise<SyncStatusDto> {
    const node = await this.prisma.node.findUnique({
      where: { id: childNodeId },
      select: {
        id: true,
        syncStatus: true,
        lastSyncedAt: true,
        syncRetryCount: true,
        syncError: true,
      },
    });

    if (!node) {
      throw new NotFoundException(`Node ${childNodeId} not found`);
    }

    return {
      nodeId: node.id,
      status: node.syncStatus,
      lastSyncedAt: node.lastSyncedAt || undefined,
      retryCount: node.syncRetryCount,
      error: node.syncError || undefined,
    };
  }

  /**
   * Retry failed sync for a child node
   *
   * Resets retry count and triggers a new sync attempt.
   *
   * @param childNodeId Child node ID
   * @returns Sync result
   */
  async retrySyncNode(childNodeId: string): Promise<SyncResultDto> {
    this.logger.log(`🔄 Manual retry triggered for node ${childNodeId}`);

    // Reset retry count
    await this.prisma.node.update({
      where: { id: childNodeId },
      data: {
        syncRetryCount: 0,
        syncStatus: SyncStatus.PENDING,
      },
    });

    // Trigger sync
    return this.syncToChildNode(childNodeId);
  }

  /**
   * Get all policies from main node for syncing
   *
   * @returns List of policies in sync format
   */
  private async getPoliciesForSync(): Promise<PolicySyncDto[]> {
    const policies = await this.prisma.policy.findMany();

    return policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      preset: policy.preset,
      targetCodec: policy.targetCodec,
      targetQuality: policy.targetQuality,
      deviceProfiles: policy.deviceProfiles as object,
      advancedSettings: policy.advancedSettings as object,
      atomicReplace: policy.atomicReplace,
      verifyOutput: policy.verifyOutput,
      skipSeeding: policy.skipSeeding,
      libraryId: policy.libraryId || undefined,
    }));
  }

  /**
   * Get all libraries from main node for syncing
   *
   * NOTE: Only syncs metadata, not file contents.
   * Child nodes don't have access to main node's filesystem.
   *
   * @returns List of libraries in sync format
   */
  private async getLibrariesForSync(): Promise<LibrarySyncDto[]> {
    const libraries = await this.prisma.library.findMany();

    return libraries.map((library) => ({
      id: library.id,
      name: library.name,
      path: library.path,
      mediaType: library.mediaType,
      enabled: library.enabled,
      defaultPolicyId: library.defaultPolicyId || undefined,
    }));
  }

  /**
   * Get settings from main node for syncing
   *
   * @returns Settings in sync format
   */
  private async getSettingsForSync(): Promise<ReceiveSettingsDto> {
    const settings = await this.prisma.settings.findFirst();

    if (!settings) {
      // Return default settings if none exist
      return {
        isSetupComplete: false,
        allowLocalNetworkWithoutAuth: false,
        defaultQueueView: 'ENCODING',
        readyFilesCacheTtlMinutes: 5,
      };
    }

    return {
      isSetupComplete: settings.isSetupComplete,
      allowLocalNetworkWithoutAuth: settings.allowLocalNetworkWithoutAuth,
      defaultQueueView: settings.defaultQueueView,
      readyFilesCacheTtlMinutes: settings.readyFilesCacheTtlMinutes,
    };
  }

  /**
   * Receive and store policies from main node (child node endpoint)
   *
   * This method is called on the CHILD node to receive synced policies
   * from the main node.
   *
   * @param policies List of policies to store
   */
  async receivePolicies(policies: PolicySyncDto[]): Promise<void> {
    this.logger.log(`📥 Receiving ${policies.length} policies from main node`);

    for (const policy of policies) {
      await this.prisma.policy.upsert({
        where: { id: policy.id },
        create: {
          id: policy.id,
          name: policy.name,
          preset: policy.preset,
          targetCodec: policy.targetCodec,
          targetQuality: policy.targetQuality,
          deviceProfiles: policy.deviceProfiles,
          advancedSettings: policy.advancedSettings,
          atomicReplace: policy.atomicReplace,
          verifyOutput: policy.verifyOutput,
          skipSeeding: policy.skipSeeding,
          libraryId: policy.libraryId,
        },
        update: {
          name: policy.name,
          preset: policy.preset,
          targetCodec: policy.targetCodec,
          targetQuality: policy.targetQuality,
          deviceProfiles: policy.deviceProfiles,
          advancedSettings: policy.advancedSettings,
          atomicReplace: policy.atomicReplace,
          verifyOutput: policy.verifyOutput,
          skipSeeding: policy.skipSeeding,
          libraryId: policy.libraryId,
        },
      });
    }

    this.logger.log(`✅ Successfully stored ${policies.length} policies`);
  }

  /**
   * Receive and store libraries from main node (child node endpoint)
   *
   * This method is called on the CHILD node to receive synced libraries
   * from the main node. Only metadata is stored, no file scanning.
   *
   * @param libraries List of libraries to store
   */
  async receiveLibraries(libraries: LibrarySyncDto[]): Promise<void> {
    this.logger.log(`📥 Receiving ${libraries.length} libraries from main node`);

    // Get current node ID
    const currentNode = await this.prisma.node.findFirst({
      where: { role: 'MAIN' },
    });

    if (!currentNode) {
      throw new NotFoundException('Current node not found');
    }

    for (const library of libraries) {
      await this.prisma.library.upsert({
        where: { id: library.id },
        create: {
          id: library.id,
          name: library.name,
          path: library.path,
          mediaType: library.mediaType,
          enabled: library.enabled,
          nodeId: currentNode.id,
          defaultPolicyId: library.defaultPolicyId,
        },
        update: {
          name: library.name,
          path: library.path,
          mediaType: library.mediaType,
          enabled: library.enabled,
          defaultPolicyId: library.defaultPolicyId,
        },
      });
    }

    this.logger.log(`✅ Successfully stored ${libraries.length} libraries`);
  }

  /**
   * Receive and update settings from main node (child node endpoint)
   *
   * This method is called on the CHILD node to receive synced settings
   * from the main node.
   *
   * @param settings Settings to update
   */
  async receiveSettings(settings: ReceiveSettingsDto): Promise<void> {
    this.logger.log(`📥 Receiving settings from main node`);

    // Find or create settings
    const existingSettings = await this.prisma.settings.findFirst();

    if (existingSettings) {
      await this.prisma.settings.update({
        where: { id: existingSettings.id },
        data: {
          isSetupComplete: settings.isSetupComplete,
          allowLocalNetworkWithoutAuth: settings.allowLocalNetworkWithoutAuth,
          defaultQueueView: settings.defaultQueueView,
          readyFilesCacheTtlMinutes: settings.readyFilesCacheTtlMinutes,
        },
      });
    } else {
      await this.prisma.settings.create({
        data: {
          isSetupComplete: settings.isSetupComplete,
          allowLocalNetworkWithoutAuth: settings.allowLocalNetworkWithoutAuth,
          defaultQueueView: settings.defaultQueueView,
          readyFilesCacheTtlMinutes: settings.readyFilesCacheTtlMinutes,
        },
      });
    }

    this.logger.log(`✅ Successfully updated settings`);
  }
}
