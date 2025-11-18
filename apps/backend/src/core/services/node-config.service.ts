import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NodeRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * NodeConfigService
 *
 * Loads and caches the current node's configuration from the database.
 * This replaces reading NODE_ROLE and MAIN_API_URL from environment variables.
 *
 * Configuration is loaded once on startup and cached in memory for performance.
 * Call reload() to refresh configuration after database updates.
 */
@Injectable()
export class NodeConfigService implements OnModuleInit {
  private readonly logger = new Logger(NodeConfigService.name);

  private config: {
    nodeId: string | null;
    role: NodeRole | null;
    mainApiUrl: string | null;
    apiKey: string | null;
  } = {
    nodeId: null,
    role: null,
    mainApiUrl: null,
    apiKey: null,
  };

  private isLoaded = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Load configuration on module initialization
   */
  async onModuleInit() {
    await this.loadConfig();
  }

  /**
   * Load node configuration from database
   */
  async loadConfig(): Promise<void> {
    try {
      // Get the current node (should only be one node per database)
      const node = await this.prisma.node.findFirst({
        select: {
          id: true,
          role: true,
          mainNodeUrl: true,
          apiKey: true,
        },
      });

      if (node) {
        this.config = {
          nodeId: node.id,
          role: node.role,
          mainApiUrl: node.mainNodeUrl,
          apiKey: node.apiKey,
        };

        this.isLoaded = true;

        this.logger.log(
          `✅ Node configuration loaded: role=${node.role}, mainApiUrl=${node.mainNodeUrl || 'N/A'}`
        );
      } else {
        this.logger.warn(
          '⚠️  No node found in database - configuration not loaded (this is normal during initial setup)'
        );
      }
    } catch (error) {
      this.logger.error('Failed to load node configuration from database:', error);
      throw error;
    }
  }

  /**
   * Reload configuration from database (call after updating node config)
   */
  async reload(): Promise<void> {
    this.logger.log('🔄 Reloading node configuration from database...');
    await this.loadConfig();
  }

  /**
   * Get the current node's role
   */
  getRole(): NodeRole | null {
    return this.config.role;
  }

  /**
   * Get the main node API URL (for LINKED nodes)
   */
  getMainApiUrl(): string | null {
    return this.config.mainApiUrl;
  }

  /**
   * Get the node's API key
   */
  getApiKey(): string | null {
    return this.config.apiKey;
  }

  /**
   * Get the current node ID
   */
  getNodeId(): string | null {
    return this.config.nodeId;
  }

  /**
   * Check if this is a MAIN node
   */
  isMainNode(): boolean {
    return this.config.role === NodeRole.MAIN;
  }

  /**
   * Check if this is a LINKED node
   */
  isLinkedNode(): boolean {
    return this.config.role === NodeRole.LINKED;
  }

  /**
   * Check if configuration has been loaded
   */
  isConfigLoaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Get full configuration object
   */
  getConfig() {
    return {
      nodeId: this.config.nodeId,
      role: this.config.role,
      mainApiUrl: this.config.mainApiUrl,
      isMainNode: this.isMainNode(),
      isLinkedNode: this.isLinkedNode(),
      isLoaded: this.isLoaded,
    };
  }
}
