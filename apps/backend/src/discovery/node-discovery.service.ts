import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NodeRole } from '@prisma/client';
import { Bonjour, Browser, Service } from 'bonjour-service';
import { NodesService } from '../nodes/nodes.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationPriority, NotificationType } from '../notifications/types/notification.types';
import { PrismaService } from '../prisma/prisma.service';
import { HardwareCapabilitiesDto } from '../system/dto/hardware-capabilities.dto';
import { HardwareDetectionService } from '../system/hardware-detection.service';

/**
 * Discovered node information from mDNS
 */
export interface DiscoveredNode {
  nodeId: string;
  name: string;
  version: string;
  apiPort: number;
  ipAddress: string;
  hostname: string;
  discoveredAt: Date;
  hardware?: HardwareCapabilitiesDto;
}

/**
 * NodeDiscoveryService
 *
 * Implements mDNS-based auto-discovery for BitBonsai distributed encoding nodes.
 *
 * MAIN node behavior:
 * - Broadcasts _bitbonsai._tcp.local service on startup
 * - Includes TXT records: nodeId, name, version, apiPort
 * - Other nodes can discover and pair with this main node
 *
 * LINKED (child) node behavior:
 * - Scans for _bitbonsai._tcp.local services on the network
 * - Discovers available MAIN nodes for pairing
 * - Does not broadcast its own service
 *
 * Pairing flow:
 * 1. Child node scans network and finds MAIN node
 * 2. Child node requests pairing with MAIN node
 * 3. MAIN node generates pairing token
 * 4. Child node exchanges token for API key
 * 5. Child node can now communicate with MAIN node
 */
@Injectable()
export class NodeDiscoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NodeDiscoveryService.name);
  private bonjour: Bonjour | null = null;
  private publishedService: Service | null = null;
  private browser: Browser | null = null;
  private discoveredNodes: Map<string, DiscoveredNode> = new Map();
  private currentNodeRole: NodeRole | null = null;

  constructor(
    readonly _prisma: PrismaService,
    private readonly nodesService: NodesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly hardwareDetectionService: HardwareDetectionService,
    private readonly notificationsService: NotificationsService
  ) {}

  /**
   * Initialize mDNS discovery service
   */
  async onModuleInit() {
    // Always initialize Bonjour first (needed for scanning even if no node exists yet)
    this.bonjour = new Bonjour();

    try {
      // Try to determine current node role
      const currentNode = await this.nodesService.getCurrentNode();
      this.currentNodeRole = currentNode.role;

      this.logger.log(`🔍 Discovery service initialized for ${this.currentNodeRole} node`);

      // If MAIN node, start broadcasting
      if (this.currentNodeRole === NodeRole.MAIN) {
        await this.startBroadcast(currentNode);
      } else {
        this.logger.log('💡 LINKED node - ready to scan for MAIN nodes');
      }
    } catch (_error) {
      // Node doesn't exist yet (e.g., during initial setup)
      // Bonjour is already initialized, so scanning will work
      this.logger.log('🔍 Discovery service initialized - no node configured yet');
    }
  }

  /**
   * Cleanup on module destruction
   */
  async onModuleDestroy() {
    await this.stopBroadcast();
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }
    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
  }

  /**
   * Start broadcasting mDNS service (MAIN node only)
   */
  private async startBroadcast(node: any): Promise<void> {
    if (!this.bonjour) {
      throw new Error('Bonjour not initialized');
    }

    try {
      const apiPort = parseInt(process.env.PORT || '3100', 10);

      // Detect hardware capabilities
      const hardware = await this.hardwareDetectionService.detectHardware();

      // Publish the service with hardware info
      this.publishedService = this.bonjour.publish({
        name: node.name,
        type: 'bitbonsai',
        port: apiPort,
        txt: {
          nodeId: node.id,
          name: node.name,
          version: node.version,
          apiPort: apiPort.toString(),
          role: 'MAIN',
          // Hardware summary in TXT records (limited by mDNS size constraints)
          accelerationType: hardware.accelerationType,
          gpuCount: hardware.gpus.length.toString(),
          cpuCores: hardware.cpu.cores.toString(),
          platform: hardware.platform,
        },
      });

      this.logger.log(`📡 Broadcasting mDNS service: _bitbonsai._tcp.local`);
      this.logger.log(`   Node ID: ${node.id}`);
      this.logger.log(`   Name: ${node.name}`);
      this.logger.log(`   Port: ${apiPort}`);
      this.logger.log(
        `   Acceleration: ${hardware.accelerationType} (${hardware.gpus.length} GPU(s))`
      );
    } catch (error) {
      this.logger.error('Failed to start mDNS broadcast:', error);
      throw error;
    }
  }

  /**
   * Stop broadcasting mDNS service
   */
  private async stopBroadcast(): Promise<void> {
    if (this.publishedService) {
      try {
        if (this.publishedService.stop) {
          this.publishedService.stop();
        }
        this.publishedService = null;
        this.logger.log('📡 Stopped mDNS broadcast');
      } catch (error) {
        this.logger.error('Failed to stop mDNS broadcast:', error);
      }
    }
  }

  /**
   * Scan for MAIN nodes on the network (LINKED node feature)
   *
   * @returns List of discovered MAIN nodes
   */
  async scanForMainNodes(): Promise<DiscoveredNode[]> {
    if (!this.bonjour) {
      throw new Error('Bonjour not initialized');
    }

    this.logger.log('🔍 Scanning for MAIN nodes on network...');

    // Clear previous discoveries
    this.discoveredNodes.clear();

    return new Promise((resolve, reject) => {
      try {
        // Create browser
        this.browser = this.bonjour?.find({ type: 'bitbonsai' }) ?? null;

        const _timeout = setTimeout(() => {
          if (this.browser) {
            this.browser.stop();
          }
          this.logger.log(`✅ Scan complete - found ${this.discoveredNodes.size} node(s)`);
          resolve(Array.from(this.discoveredNodes.values()));
        }, 5000); // 5 second scan

        if (!this.browser) {
          reject(new Error('Failed to create browser'));
          return;
        }

        this.browser.on('up', async (service: Service) => {
          try {
            const nodeId = service.txt?.nodeId;
            const name = service.txt?.name || service.name;
            const version = service.txt?.version || 'unknown';
            const apiPort = parseInt(
              service.txt?.apiPort || service.port?.toString() || '3100',
              10
            );
            const ipAddress = service.addresses?.[0] || 'unknown';
            const hostname = service.host || 'unknown';

            if (nodeId) {
              const discovered: DiscoveredNode = {
                nodeId,
                name,
                version,
                apiPort,
                ipAddress,
                hostname,
                discoveredAt: new Date(),
              };

              // Try to fetch full hardware capabilities from the node
              try {
                const hardwareResponse = await fetch(
                  `http://${ipAddress}:${apiPort}/api/v1/system/hardware`
                );
                if (hardwareResponse.ok) {
                  const hardware = await hardwareResponse.json();
                  discovered.hardware = hardware;
                  this.logger.log(
                    `   ✓ Found: ${name} (${ipAddress}:${apiPort}) - ${hardware.accelerationType}`
                  );
                } else {
                  this.logger.log(`   ✓ Found: ${name} (${ipAddress}:${apiPort})`);
                }
              } catch (_fetchError) {
                // Hardware fetch failed, but node is still valid
                this.logger.log(`   ✓ Found: ${name} (${ipAddress}:${apiPort})`);
              }

              this.discoveredNodes.set(nodeId, discovered);

              // Emit event for real-time updates
              this.eventEmitter.emit('node.discovered', discovered);

              // Create notification for discovered node
              this.notificationsService
                .createNotification({
                  type: NotificationType.NODE_DISCOVERED,
                  priority: NotificationPriority.HIGH,
                  title: 'New Node Discovered',
                  message: `${name} is ready to join your network`,
                  data: {
                    nodeId,
                    nodeName: name,
                    ipAddress,
                    hostname,
                    version,
                  },
                })
                .then((notification) => {
                  // Emit event to broadcast via WebSocket
                  this.eventEmitter.emit('notification.created', notification);
                })
                .catch((error) => {
                  this.logger.error('Failed to create notification:', error);
                });
            }
          } catch (error) {
            this.logger.warn('Failed to process discovered service:', error);
          }
        });

        this.browser.on('down', (service: Service) => {
          const nodeId = service.txt?.nodeId;
          if (nodeId && this.discoveredNodes.has(nodeId)) {
            const node = this.discoveredNodes.get(nodeId);
            this.logger.log(`   ✗ Lost: ${node?.name}`);
            this.discoveredNodes.delete(nodeId);
            this.eventEmitter.emit('node.lost', nodeId);
          }
        });

        this.browser.start();
      } catch (error) {
        this.logger.error('Failed to scan for nodes:', error);
        reject(error);
      }
    });
  }

  /**
   * Get list of currently discovered nodes (cached)
   */
  getDiscoveredNodes(): DiscoveredNode[] {
    return Array.from(this.discoveredNodes.values());
  }

  /**
   * Clear discovered nodes cache
   */
  clearDiscoveredNodes(): void {
    this.discoveredNodes.clear();
    this.logger.log('🗑️  Cleared discovered nodes cache');
  }

  /**
   * Request pairing with a discovered MAIN node
   *
   * @param mainNodeUrl Base URL of the MAIN node (e.g., http://192.168.1.100:3100)
   * @param mainNodeId Node ID of the MAIN node
   * @returns Pairing token to complete pairing
   */
  async requestPairing(mainNodeUrl: string, mainNodeId: string): Promise<string> {
    this.logger.log(`🔗 Requesting pairing with MAIN node: ${mainNodeUrl}`);

    try {
      // Get current node info
      const _currentNode = await this.nodesService.getCurrentNode();

      // Make HTTP request to MAIN node to request pairing
      const response = await fetch(`${mainNodeUrl}/api/v1/nodes/${mainNodeId}/pairing-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Pairing request failed: ${response.statusText}`);
      }

      const data = await response.json();
      this.logger.log(`✅ Pairing token received: ${data.pairingToken}`);

      return data.pairingToken;
    } catch (error) {
      this.logger.error('Failed to request pairing:', error);
      throw error;
    }
  }

  /**
   * Complete pairing by exchanging token for API key
   *
   * @param mainNodeUrl Base URL of the MAIN node
   * @param pairingToken 6-digit pairing token
   * @returns Node details with API key
   */
  async completePairing(mainNodeUrl: string, pairingToken: string): Promise<any> {
    this.logger.log(`🔐 Completing pairing with token: ${pairingToken}`);

    try {
      const response = await fetch(`${mainNodeUrl}/api/v1/nodes/pair`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pairingToken }),
      });

      if (!response.ok) {
        throw new Error(`Pairing completion failed: ${response.statusText}`);
      }

      const data = await response.json();
      this.logger.log(`✅ Pairing complete - received API key`);

      return data;
    } catch (error) {
      this.logger.error('Failed to complete pairing:', error);
      throw error;
    }
  }

  /**
   * Approve a discovered node
   *
   * This method is a placeholder for the approval flow.
   * In a real implementation, this would be triggered when the user
   * clicks "Approve" in the UI. The sync trigger is handled by the controller.
   *
   * @param nodeId ID of the node to approve
   * @returns Approved node details
   */
  async approveNode(nodeId: string): Promise<any> {
    // For now, just return the node from the nodes service
    // In a real implementation, this would update a DiscoveredNode status
    return this.nodesService.findOne(nodeId);
  }

  /**
   * Reject a discovered node
   *
   * This method is a placeholder for the rejection flow.
   * In a real implementation, this would mark the node as rejected
   * so it doesn't appear in the discovered nodes list.
   *
   * @param nodeId ID of the node to reject
   */
  async rejectNode(nodeId: string): Promise<void> {
    this.logger.log(`🚫 Rejecting discovered node: ${nodeId}`);
    // In a real implementation, this would update a DiscoveredNode status
    // For now, we'll just remove it from the cache
    this.discoveredNodes.delete(nodeId);
  }
}
