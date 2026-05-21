import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { type Node, NodeRole } from '@prisma/client';
import { NodeRepository } from '../../common/repositories/node.repository';
import { DataAccessService } from '../../core/services/data-access.service';
import type { HeartbeatDto } from '../dto/heartbeat.dto';
import { SystemInfoService } from './system-info.service';

/**
 * NodeHeartbeatService
 *
 * Handles node heartbeat recording, uptime tracking,
 * and the @Interval auto-heartbeat scheduler.
 */
@Injectable()
export class NodeHeartbeatService {
  private readonly logger = new Logger(NodeHeartbeatService.name);

  constructor(
    private readonly nodeRepository: NodeRepository,
    private readonly dataAccessService: DataAccessService,
    private readonly systemInfoService: SystemInfoService
  ) {}

  /**
   * Auto-heartbeat for current node (works for both MAIN and LINKED)
   * Uses @Interval decorator for resilience to hot reloads.
   * Sends heartbeat every 30 seconds to keep status updated.
   *
   * - MAIN nodes: Updates local database
   * - LINKED nodes: Sends heartbeat to MAIN node via API
   */
  @Interval(30000)
  async sendAutoHeartbeat(): Promise<void> {
    try {
      const currentNode = await this.nodeRepository.findFirstNode();

      if (!currentNode) {
        this.logger.warn('No node found in local database - skipping heartbeat');
        return;
      }

      if (currentNode.role === NodeRole.MAIN) {
        await this.heartbeat(currentNode.id);
        this.logger.debug(`[MAIN] Heartbeat sent for ${currentNode.name}`);
      } else {
        await this.dataAccessService.sendHeartbeat(currentNode.id);
        this.logger.debug(`[LINKED] Heartbeat sent for ${currentNode.name} to MAIN API`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to send auto-heartbeat: ${errorMessage}`);
      if (errorStack) {
        this.logger.error(errorStack);
      }
    }
  }

  /**
   * Record node heartbeat and update statistics.
   *
   * @param nodeId Node identifier
   * @param data Optional status, metrics, and IP address
   * @returns Updated node
   * @throws NotFoundException if node doesn't exist
   */
  async heartbeat(nodeId: string, data?: HeartbeatDto): Promise<Node> {
    const node = await this.nodeRepository.findById(nodeId);

    if (!node) {
      throw new NotFoundException(`Node with ID ${nodeId} not found`);
    }

    let ipAddressToUpdate: string | undefined;

    if (data?.ipAddress) {
      ipAddressToUpdate = data.ipAddress;
      this.logger.debug(`Using IP from heartbeat payload for ${node.name}: ${data.ipAddress}`);
    } else if (node.role === NodeRole.MAIN) {
      const systemInfo = await this.systemInfoService.collectSystemInfo();
      ipAddressToUpdate = systemInfo.ipAddress;
      this.logger.debug(`Auto-detected IP for MAIN node ${node.name}: ${systemInfo.ipAddress}`);
    }

    if (ipAddressToUpdate && node.ipAddress !== ipAddressToUpdate) {
      this.logger.log(
        `Updating IP address for ${node.name}: ${node.ipAddress || 'none'} → ${ipAddressToUpdate}`
      );
    }

    return this.nodeRepository.updateData(nodeId, {
      status: data?.status || 'ONLINE',
      lastHeartbeat: new Date(),
      uptimeSeconds: { increment: 60 },
      ...(ipAddressToUpdate && { ipAddress: ipAddressToUpdate }),
    });
  }

  /**
   * Update node uptime manually.
   *
   * @param nodeId Node identifier
   * @param incrementSeconds Seconds to add to uptime
   */
  async updateUptime(nodeId: string, incrementSeconds: number): Promise<Node> {
    const node = await this.nodeRepository.findById(nodeId);

    if (!node) {
      throw new NotFoundException(`Node with ID ${nodeId} not found`);
    }

    return this.nodeRepository.updateData(nodeId, {
      uptimeSeconds: { increment: incrementSeconds },
    });
  }
}
