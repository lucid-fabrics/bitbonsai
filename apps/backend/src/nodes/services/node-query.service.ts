import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type AccelerationType, type Node, NodeRole } from '@prisma/client';
import * as os from 'os';
import { NodeRepository } from '../../common/repositories/node.repository';
import type { NodeStatsDto } from '../dto/node-stats.dto';
import type { OptimalConfigDto } from '../dto/optimal-config.dto';
import {
  calculateOptimalWorkers,
  getRecommendationSummary,
} from '../utils/optimal-worker-calculator';
import { SystemInfoService } from './system-info.service';

/**
 * NodeQueryService
 *
 * Handles read-only node queries: findAll, findOne, getCurrentNode,
 * getCapabilities, and storage method recommendations.
 */
@Injectable()
export class NodeQueryService {
  private readonly logger = new Logger(NodeQueryService.name);

  constructor(
    private readonly nodeRepository: NodeRepository,
    private readonly systemInfoService: SystemInfoService
  ) {}

  /**
   * Get all nodes with basic information.
   */
  async findAll(): Promise<Node[]> {
    const nodes = await this.nodeRepository.findAllWithLicense();

    const now = new Date();
    return nodes.map((node) => ({
      ...node,
      uptimeSeconds: Math.floor((now.getTime() - node.createdAt.getTime()) / 1000),
    }));
  }

  /**
   * Get a specific node by ID.
   *
   * @throws NotFoundException if node doesn't exist
   */
  async findOne(id: string): Promise<Node> {
    const node = await this.nodeRepository.findById(id);

    if (!node) {
      throw new NotFoundException(`Node with ID ${id} not found`);
    }

    return node;
  }

  /**
   * Find a node by API key (for authentication).
   */
  async findByApiKey(apiKey: string): Promise<Node | null> {
    return this.nodeRepository.findByApiKey(apiKey);
  }

  /**
   * Get the current node's information.
   *
   * Determines which node this instance is by using multiple strategies:
   * 1. NODE_ID environment variable (explicit configuration)
   * 2. IP address matching (detects correct node automatically)
   * 3. Fallback to role-based detection (MAIN first, then LINKED)
   *
   * @throws NotFoundException if no nodes exist or NODE_ID is invalid
   */
  async getCurrentNode(): Promise<Node> {
    const nodeId = process.env.NODE_ID;

    const systemInfo = await this.systemInfoService.collectSystemInfo();
    const currentIpAddress = systemInfo.ipAddress;

    const autoUpdateIpIfNeeded = async (node: Node): Promise<Node> => {
      if (
        currentIpAddress &&
        node.ipAddress !== currentIpAddress &&
        currentIpAddress !== '127.0.0.1'
      ) {
        this.logger.warn(
          `AUTO-IP-UPDATE: Node "${node.name}" IP changed from ${node.ipAddress} to ${currentIpAddress}`
        );
        return this.nodeRepository.updateData(node.id, {
          ipAddress: currentIpAddress,
        });
      }
      return node;
    };

    if (nodeId) {
      const node = await this.nodeRepository.findById(nodeId);

      if (!node) {
        throw new NotFoundException(`Node with ID ${nodeId} (from NODE_ID env) not found`);
      }

      return autoUpdateIpIfNeeded(node);
    }

    if (currentIpAddress) {
      const nodesByIp = await this.nodeRepository.findManyByIp(currentIpAddress);

      if (nodesByIp.length > 0) {
        const mainNode = nodesByIp.find((n) => n.role === 'MAIN');
        const selectedNode = mainNode || nodesByIp[0];

        if (nodesByIp.length > 1) {
          this.logger.warn(
            `Multiple nodes detected with IP ${currentIpAddress} (${nodesByIp.length} total)`
          );
          this.logger.warn(
            `Using ${selectedNode.role} node: ${selectedNode.name} (${selectedNode.id})`
          );
          this.logger.warn(
            `Duplicates: ${nodesByIp
              .filter((n) => n.id !== selectedNode.id)
              .map((n) => `${n.name} (${n.role})`)
              .join(', ')}`
          );
        }

        this.logger.debug(
          `Detected current node by IP address: ${selectedNode.name} (${selectedNode.role}) at ${currentIpAddress}`
        );
        return selectedNode;
      }
    }

    const mainNodes = await this.nodeRepository.findManyByRole(NodeRole.MAIN, {
      orderBy: { createdAt: 'asc' },
    });

    if (mainNodes.length > 1) {
      this.logger.warn(
        `Multiple MAIN nodes detected (${mainNodes.length})! This is a data inconsistency.`
      );
      this.logger.warn(
        `Using newest MAIN node: ${mainNodes[mainNodes.length - 1].name} (${mainNodes[mainNodes.length - 1].id})`
      );
      this.logger.warn(
        `Consider cleaning up old MAIN nodes: ${mainNodes
          .slice(0, -1)
          .map((n) => n.id)
          .join(', ')}`
      );
      return autoUpdateIpIfNeeded(mainNodes[mainNodes.length - 1]);
    }

    if (mainNodes.length === 1) {
      return autoUpdateIpIfNeeded(mainNodes[0]);
    }

    const linkedNode = await this.nodeRepository.findFirstByRole(NodeRole.LINKED, {
      orderBy: { createdAt: 'desc' },
    });

    if (linkedNode) {
      return autoUpdateIpIfNeeded(linkedNode);
    }

    throw new NotFoundException('No nodes found. Please complete setup first.');
  }

  /**
   * Get node with comprehensive statistics.
   *
   * @throws NotFoundException if node doesn't exist
   */
  async getNodeStats(nodeId: string): Promise<NodeStatsDto> {
    const node = await this.nodeRepository.findWithStats(nodeId);

    if (!node) {
      throw new NotFoundException(`Node with ID ${nodeId} not found`);
    }

    const now = new Date();
    const uptimeSeconds = Math.floor((now.getTime() - node.createdAt.getTime()) / 1000);

    return {
      id: node.id,
      name: node.name,
      role: node.role,
      status: node.status,
      version: node.version,
      acceleration: node.acceleration,
      lastHeartbeat: node.lastHeartbeat,
      uptimeSeconds,
      createdAt: node.createdAt,
      libraries: node.libraries,
      activeJobCount: node._count.jobs,
    };
  }

  /**
   * Get recommended optimal configuration for a node.
   *
   * @throws NotFoundException if node doesn't exist
   */
  async getRecommendedConfig(nodeId: string): Promise<OptimalConfigDto> {
    const node = await this.nodeRepository.findWithSelect<{
      id: string;
      maxWorkers: number;
      acceleration: AccelerationType;
    }>(nodeId, { id: true, maxWorkers: true, acceleration: true });

    if (!node) {
      throw new NotFoundException(`Node with ID ${nodeId} not found`);
    }

    const cpuCores = os.cpus().length;
    const ramGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
    const optimalConfig = calculateOptimalWorkers(cpuCores, node.acceleration, ramGb);
    const summary = getRecommendationSummary(node.maxWorkers, optimalConfig);

    return {
      recommendedMaxWorkers: optimalConfig.recommendedMaxWorkers,
      currentMaxWorkers: node.maxWorkers,
      cpuCoresPerJob: optimalConfig.cpuCoresPerJob,
      estimatedLoadAverage: optimalConfig.estimatedLoadAverage,
      reasoning: optimalConfig.reasoning,
      summary,
      totalCpuCores: cpuCores,
      acceleration: node.acceleration,
    };
  }

  /**
   * Recommend storage method between two nodes.
   */
  async recommendStorageMethod(sourceNodeId: string, targetNodeId: string): Promise<unknown> {
    const { EnvironmentDetectorService, ContainerType } = await import(
      '../../core/services/environment-detector.service'
    );
    const detector = new EnvironmentDetectorService();

    const sourceNode = await this.findOne(sourceNodeId);
    const targetNode = await this.findOne(targetNodeId);

    const sourceSubnet = sourceNode.networkLocation ? String(sourceNode.networkLocation) : null;
    const targetSubnet = targetNode.networkLocation ? String(targetNode.networkLocation) : null;

    const containerValues = Object.values(ContainerType) as string[];
    const toContainerType = (val: string | null) =>
      val && containerValues.includes(val)
        ? (val as (typeof ContainerType)[keyof typeof ContainerType])
        : ContainerType.UNKNOWN;

    return detector.recommendStorageMethod(
      {
        subnet: sourceSubnet,
        containerType: toContainerType(sourceNode.containerType),
        canMountNFS: sourceNode.canMountNFS || false,
      },
      {
        subnet: targetSubnet,
        containerType: toContainerType(targetNode.containerType),
        canMountNFS: targetNode.canMountNFS || false,
      }
    );
  }
}
