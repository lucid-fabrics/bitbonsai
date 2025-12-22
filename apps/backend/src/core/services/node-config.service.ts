import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NodeRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * NodeConfigService
 *
 * Loads and caches the current node's configuration from the database.
 * This replaces reading NODE_ROLE and MAIN_API_URL from environment variables.
 *
 * CRITICAL FIX: Uses persistent node ID storage to prevent identity confusion
 * in multi-node setups with shared PostgreSQL database.
 *
 * Node identity detection priority:
 * 1. NODE_ID environment variable (explicit configuration)
 * 2. Persisted node ID from /data/.node-id file (survives restarts)
 * 3. IP address matching against database records
 * 4. Fallback to role-based detection (MAIN first)
 *
 * Configuration is loaded once on startup and cached in memory for performance.
 * Call reload() to refresh configuration after database updates.
 */
@Injectable()
export class NodeConfigService implements OnModuleInit {
  private readonly logger = new Logger(NodeConfigService.name);

  // Persistent node ID storage path
  private readonly NODE_ID_FILE = process.env.NODE_ID_FILE || '/data/.node-id';

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
   * Load node configuration from database with smart identity detection
   *
   * CRITICAL FIX: Uses multiple strategies to correctly identify the current node
   * in multi-node setups with shared PostgreSQL database.
   */
  async loadConfig(): Promise<void> {
    try {
      // Step 1: Determine the correct node ID
      const nodeId = await this.detectCurrentNodeId();

      if (!nodeId) {
        this.logger.warn(
          '⚠️  No node found in database - configuration not loaded (this is normal during initial setup)'
        );
        return;
      }

      // Step 2: Load the node configuration
      const node = await this.prisma.node.findUnique({
        where: { id: nodeId },
        select: {
          id: true,
          role: true,
          mainNodeUrl: true,
          apiKey: true,
          name: true,
        },
      });

      if (!node) {
        this.logger.error(`Node with ID ${nodeId} not found in database - ID may be stale`);
        // Clear persisted ID and retry detection
        this.clearPersistedNodeId();
        const retryNodeId = await this.detectCurrentNodeId();
        if (retryNodeId) {
          return this.loadConfig(); // Retry with fresh detection
        }
        return;
      }

      this.config = {
        nodeId: node.id,
        role: node.role,
        mainApiUrl: node.mainNodeUrl,
        apiKey: node.apiKey,
      };

      this.isLoaded = true;

      // Persist the node ID for future startups
      this.persistNodeId(node.id);

      this.logger.log(
        `✅ Node configuration loaded: ${node.name} (${node.role}), id=${node.id}, mainApiUrl=${node.mainNodeUrl || 'N/A'}`
      );
    } catch (error) {
      this.logger.error('Failed to load node configuration from database:', error);
      throw error;
    }
  }

  /**
   * Detect the current node ID using multiple strategies
   *
   * Priority:
   * 1. NODE_ID environment variable (highest priority - explicit config)
   * 2. Persisted node ID from file (survives restarts)
   * 3. IP address matching (auto-detection)
   * 4. Role-based fallback (MAIN first, then first LINKED)
   *
   * @returns Node ID or null if no node can be determined
   * @private
   */
  private async detectCurrentNodeId(): Promise<string | null> {
    // Strategy 1: NODE_ID environment variable
    const envNodeId = process.env.NODE_ID;
    if (envNodeId) {
      this.logger.log(`🔑 Using NODE_ID from environment: ${envNodeId}`);
      return envNodeId;
    }

    // Strategy 2: Persisted node ID from file
    const persistedNodeId = this.getPersistedNodeId();
    if (persistedNodeId) {
      // Verify the persisted ID still exists in database
      const exists = await this.prisma.node.findUnique({
        where: { id: persistedNodeId },
        select: { id: true },
      });
      if (exists) {
        this.logger.log(`📁 Using persisted NODE_ID from ${this.NODE_ID_FILE}: ${persistedNodeId}`);
        return persistedNodeId;
      }
      this.logger.warn(`⚠️  Persisted NODE_ID ${persistedNodeId} no longer exists in database`);
      this.clearPersistedNodeId();
    }

    // Strategy 3: IP address matching
    const currentIp = this.getCurrentIpAddress();
    if (currentIp) {
      const nodeByIp = await this.prisma.node.findFirst({
        where: { ipAddress: currentIp },
        select: { id: true, name: true, role: true },
        orderBy: { createdAt: 'asc' },
      });
      if (nodeByIp) {
        this.logger.log(
          `🌐 Detected node by IP address ${currentIp}: ${nodeByIp.name} (${nodeByIp.role})`
        );
        return nodeByIp.id;
      }
    }

    // Strategy 4: Role-based fallback
    // First try MAIN node (for main deployments)
    const mainNode = await this.prisma.node.findFirst({
      where: { role: NodeRole.MAIN },
      select: { id: true, name: true },
      orderBy: { createdAt: 'desc' }, // Newest MAIN node
    });
    if (mainNode) {
      this.logger.log(`🏠 Falling back to MAIN node: ${mainNode.name} (${mainNode.id})`);
      return mainNode.id;
    }

    // Then try first LINKED node
    const linkedNode = await this.prisma.node.findFirst({
      where: { role: NodeRole.LINKED },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    if (linkedNode) {
      this.logger.log(`🔗 Falling back to LINKED node: ${linkedNode.name} (${linkedNode.id})`);
      return linkedNode.id;
    }

    return null;
  }

  /**
   * Get the current machine's primary IP address
   * @private
   */
  private getCurrentIpAddress(): string | null {
    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        const iface = interfaces[name];
        if (!iface) continue;
        for (const info of iface) {
          // Skip loopback and non-IPv4 addresses
          if (info.family === 'IPv4' && !info.internal) {
            return info.address;
          }
        }
      }
    } catch (error) {
      this.logger.warn('Failed to detect IP address:', error);
    }
    return null;
  }

  /**
   * Get persisted node ID from file
   * @private
   */
  private getPersistedNodeId(): string | null {
    try {
      if (fs.existsSync(this.NODE_ID_FILE)) {
        const nodeId = fs.readFileSync(this.NODE_ID_FILE, 'utf-8').trim();
        if (nodeId) {
          return nodeId;
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to read persisted node ID from ${this.NODE_ID_FILE}:`, error);
    }
    return null;
  }

  /**
   * Persist node ID to file for future startups
   * @private
   */
  private persistNodeId(nodeId: string): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.NODE_ID_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.NODE_ID_FILE, nodeId, 'utf-8');
      this.logger.debug(`📁 Persisted node ID to ${this.NODE_ID_FILE}`);
    } catch (error) {
      this.logger.warn(`Failed to persist node ID to ${this.NODE_ID_FILE}:`, error);
      // Non-fatal - continue without persistence
    }
  }

  /**
   * Clear persisted node ID file
   * @private
   */
  private clearPersistedNodeId(): void {
    try {
      if (fs.existsSync(this.NODE_ID_FILE)) {
        fs.unlinkSync(this.NODE_ID_FILE);
        this.logger.debug(`🗑️ Cleared persisted node ID from ${this.NODE_ID_FILE}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to clear persisted node ID from ${this.NODE_ID_FILE}:`, error);
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
