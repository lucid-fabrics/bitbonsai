import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NodeRole } from '@prisma/client';
import Bonjour, { Service } from 'bonjour-service';
import { version as APP_VERSION } from '../../../../../package.json';
import { PrismaService } from '../../prisma/prisma.service';

export interface DiscoveredMainNode {
  nodeId: string;
  nodeName: string;
  ipAddress: string;
  port: number;
  apiUrl: string;
  version: string;
  discovered: boolean;
}

/**
 * Service to handle mDNS-based node discovery
 * - MAIN nodes broadcast their presence
 * - CHILD nodes discover MAIN nodes
 */
@Injectable()
export class NodeDiscoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NodeDiscoveryService.name);
  private bonjour: Bonjour | null = null;
  private service: Service | null = null;
  private readonly SERVICE_TYPE = 'bitbonsai-main';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Initialize mDNS broadcasting if this is a MAIN node
   */
  async onModuleInit() {
    // Check if this node is a MAIN node
    const mainNode = await this.prisma.node.findFirst({
      where: { role: NodeRole.MAIN },
    });

    if (mainNode) {
      await this.startBroadcasting(mainNode.id, mainNode.name);
    }
  }

  /**
   * Stop broadcasting on module destroy
   */
  async onModuleDestroy() {
    this.stopBroadcasting();
  }

  /**
   * Start broadcasting this MAIN node's presence via mDNS
   */
  async startBroadcasting(nodeId: string, nodeName: string): Promise<void> {
    try {
      this.bonjour = new Bonjour();
      const port = parseInt(process.env.PORT || '3000', 10);
      const apiUrl = process.env.API_BASE_URL || `http://${this.getLocalIP()}:${port}/api/v1`;

      this.service = this.bonjour.publish({
        name: nodeName,
        type: this.SERVICE_TYPE,
        port,
        txt: {
          nodeId,
          version: APP_VERSION, // Read from package.json
          apiUrl,
        },
      });

      this.logger.log(`🌐 Broadcasting MAIN node "${nodeName}" via mDNS on port ${port}`);
      this.logger.debug(`API URL: ${apiUrl}`);
    } catch (error) {
      this.logger.error('Failed to start mDNS broadcasting', error);
    }
  }

  /**
   * Stop broadcasting this node
   */
  stopBroadcasting(): void {
    try {
      if (this.service) {
        this.service.stop?.();
        this.service = null;
        this.logger.log('🛑 Stopped mDNS broadcasting');
      }

      if (this.bonjour) {
        this.bonjour.destroy();
        this.bonjour = null;
      }
    } catch (error) {
      this.logger.error('Failed to stop mDNS broadcasting', error);
    }
  }

  /**
   * Discover MAIN nodes on the network (for CHILD nodes)
   * @param timeoutMs Discovery timeout in milliseconds (default: 5000)
   */
  async discoverMainNodes(timeoutMs = 5000): Promise<DiscoveredMainNode[]> {
    return new Promise((resolve, reject) => {
      try {
        const bonjour = new Bonjour();
        const nodes: DiscoveredMainNode[] = [];
        const nodeIds = new Set<string>(); // Track unique node IDs
        const localIP = this.getLocalIP();
        const currentPort = parseInt(process.env.PORT || '3100', 10);

        this.logger.log(`🔍 Discovering MAIN nodes on the network (timeout: ${timeoutMs}ms)...`);
        this.logger.debug(`Local IP: ${localIP}, Port: ${currentPort}`);

        const browser = bonjour.find({ type: this.SERVICE_TYPE });

        browser.on('up', (service: Service) => {
          try {
            const nodeId = service.txt?.nodeId as string;
            const serviceIP = service.referer?.address || service.addresses?.[0] || 'unknown';
            const servicePort = service.port;

            // Skip if we've already found this node
            if (nodeIds.has(nodeId)) {
              return;
            }

            // Skip if this is the local node (same IP and port)
            if (serviceIP === localIP && servicePort === currentPort) {
              this.logger.debug(
                `⏭️  Skipping local node: ${service.name} (${serviceIP}:${servicePort})`
              );
              return;
            }

            nodeIds.add(nodeId);

            const mainNode: DiscoveredMainNode = {
              nodeId,
              nodeName: service.name,
              ipAddress: serviceIP,
              port: servicePort,
              apiUrl: service.txt?.apiUrl as string,
              version: service.txt?.version as string,
              discovered: true,
            };

            nodes.push(mainNode);

            this.logger.debug(
              `✅ Discovered MAIN node: ${mainNode.nodeName} (${mainNode.ipAddress}:${mainNode.port})`
            );
          } catch (error) {
            this.logger.warn('Failed to parse discovered service', error);
          }
        });

        // Stop discovery after timeout
        setTimeout(() => {
          browser.stop();
          bonjour.destroy();

          this.logger.log(`🎯 Discovery completed. Found ${nodes.length} MAIN node(s)`);
          resolve(nodes);
        }, timeoutMs);
      } catch (error) {
        this.logger.error('Failed to discover MAIN nodes', error);
        reject(error);
      }
    });
  }

  /**
   * Get local IP address (best guess)
   */
  private getLocalIP(): string {
    const os = require('os');
    const interfaces = os.networkInterfaces();

    for (const [_name, addrs] of Object.entries(interfaces)) {
      if (!addrs || !Array.isArray(addrs)) continue;

      for (const addr of addrs) {
        // Skip internal and non-IPv4 addresses
        if (addr && addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }

    return 'localhost';
  }
}
