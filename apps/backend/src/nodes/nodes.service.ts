import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { type Node, NodeRole } from '@prisma/client';
import * as os from 'os';
import { NodeRepository } from '../common/repositories/node.repository';
import type { HeartbeatDto } from './dto/heartbeat.dto';
import type { NodeRegistrationResponseDto } from './dto/node-registration-response.dto';
import type { NodeStatsDto } from './dto/node-stats.dto';
import type { OptimalConfigDto } from './dto/optimal-config.dto';
import type { RegisterNodeDto } from './dto/register-node.dto';
import type { UpdateNodeDto } from './dto/update-node.dto';
import { NodeCapabilityDetectorService } from './services/node-capability-detector.service';
import { NodeHeartbeatService } from './services/node-heartbeat.service';
import { NodeQueryService } from './services/node-query.service';
import { NodeRegistrationService } from './services/node-registration.service';
import { calculateOptimalWorkers } from './utils/optimal-worker-calculator';

/**
 * NodesService
 *
 * Thin facade delegating to focused sub-services:
 * - NodeRegistrationService: registration, pairing, removal
 * - NodeHeartbeatService: heartbeat tracking and auto-scheduler
 * - NodeQueryService: read-only queries and recommendations
 */
@Injectable()
export class NodesService implements OnModuleInit {
  private readonly logger = new Logger(NodesService.name);

  constructor(
    private readonly nodeRepository: NodeRepository,
    private readonly nodeRegistration: NodeRegistrationService,
    private readonly nodeHeartbeat: NodeHeartbeatService,
    private readonly nodeQuery: NodeQueryService,
    private readonly capabilityDetector: NodeCapabilityDetectorService
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing nodes service...');
    this.logger.log('Auto-heartbeat started (every 30s)');
    this.nodeHeartbeat.sendAutoHeartbeat();
  }

  // --- Registration ---

  async registerNode(data: RegisterNodeDto): Promise<NodeRegistrationResponseDto> {
    return this.nodeRegistration.registerNode(data);
  }

  async pairNode(pairingToken: string): Promise<Node> {
    return this.nodeRegistration.pairNode(pairingToken);
  }

  async generatePairingTokenForNode(nodeId: string): Promise<NodeRegistrationResponseDto> {
    return this.nodeRegistration.generatePairingTokenForNode(nodeId);
  }

  async remove(id: string): Promise<void> {
    const node = await this.nodeRepository.findWithSelect<{
      id: string;
      name: string;
      role: string;
      publicUrl: string | null;
      mainNodeUrl: string | null;
      apiKey: string;
    }>(id, {
      id: true,
      name: true,
      role: true,
      publicUrl: true,
      mainNodeUrl: true,
      apiKey: true,
    });

    if (!node) {
      throw new NotFoundException(`Node with ID ${id} not found`);
    }

    if (node.role === NodeRole.LINKED) {
      const childUrl = node.publicUrl || node.mainNodeUrl;
      if (childUrl) {
        try {
          this.logger.log(
            `Notifying child node ${node.name} (${childUrl}) to reset after unlink from main node`
          );

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          try {
            const response = await fetch(`${childUrl}/api/v1/nodes/unregister-self`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${node.apiKey}`,
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.ok) {
              this.logger.log(`Child node ${node.name} successfully notified to reset`);
            } else {
              this.logger.warn(
                `Child node ${node.name} returned status ${response.status} - may need manual reset`
              );
            }
          } catch (fetchError: unknown) {
            clearTimeout(timeoutId);
            if (fetchError instanceof Error && fetchError.name === 'AbortError') {
              this.logger.warn(
                `Timeout notifying child node ${node.name} (>5s) - proceeding with deletion`
              );
            } else {
              const errorMessage =
                fetchError instanceof Error ? fetchError.message : 'Unknown error';
              this.logger.warn(
                `Failed to notify child node ${node.name}: ${errorMessage} - proceeding with deletion`
              );
            }
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `Failed to notify child node ${node.name} to reset: ${errorMessage} - child may need manual reset`
          );
        }
      } else {
        this.logger.warn(`Child node ${node.name} has no URL configured - cannot notify to reset`);
      }
    }

    await this.nodeRepository.deleteById(id);
    this.logger.log(`Node ${node.name} (${id}) deleted from main node's database`);
  }

  async unregisterSelf(): Promise<{ success: boolean; message: string }> {
    const currentNode = await this.getCurrentNode();

    if (currentNode.role === NodeRole.MAIN) {
      throw new BadRequestException('MAIN nodes cannot unregister');
    }

    this.logger.log(`Unregistering node: ${currentNode.name} (${currentNode.id})`);

    if (currentNode.mainNodeUrl) {
      try {
        this.logger.log(
          `Notifying main node at ${currentNode.mainNodeUrl} to remove this child node`
        );
        const response = await fetch(`${currentNode.mainNodeUrl}/api/v1/nodes/${currentNode.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          this.logger.log(`Main node successfully removed child node ${currentNode.id}`);
        } else {
          this.logger.warn(`Main node returned status ${response.status} when removing child node`);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Failed to notify main node: ${errorMessage}`);
      }
    } else {
      this.logger.warn(`No mainNodeUrl found - cannot notify main node of unregistration`);
    }

    await this.nodeRepository.updateData(currentNode.id, {
      role: NodeRole.MAIN,
      pairingToken: null,
      pairingExpiresAt: null,
      mainNodeUrl: null,
    });

    this.logger.log(`Node reset to unconfigured state`);

    return {
      success: true,
      message: 'Node unregistered successfully. Please reconfigure this node.',
    };
  }

  // --- Heartbeat ---

  async heartbeat(nodeId: string, data?: HeartbeatDto): Promise<Node> {
    return this.nodeHeartbeat.heartbeat(nodeId, data);
  }

  // --- Queries ---

  async findAll(): Promise<Node[]> {
    return this.nodeQuery.findAll();
  }

  async findOne(id: string): Promise<Node> {
    return this.nodeQuery.findOne(id);
  }

  async findByApiKey(apiKey: string): Promise<Node | null> {
    return this.nodeQuery.findByApiKey(apiKey);
  }

  async getCurrentNode(): Promise<Node> {
    return this.nodeQuery.getCurrentNode();
  }

  async getNodeStats(nodeId: string): Promise<NodeStatsDto> {
    return this.nodeQuery.getNodeStats(nodeId);
  }

  async getRecommendedConfig(nodeId: string): Promise<OptimalConfigDto> {
    return this.nodeQuery.getRecommendedConfig(nodeId);
  }

  async recommendStorageMethod(sourceNodeId: string, targetNodeId: string): Promise<unknown> {
    return this.nodeQuery.recommendStorageMethod(sourceNodeId, targetNodeId);
  }

  async testNodeCapabilities(id: string): Promise<Record<string, unknown>> {
    const node = await this.findOne(id);

    let nodeIp = node.ipAddress || '127.0.0.1';

    if (!node.ipAddress) {
      const urlToUse = node.publicUrl || node.mainNodeUrl;
      if (urlToUse) {
        try {
          const url = new URL(urlToUse);
          nodeIp = url.hostname;
        } catch (error: unknown) {
          this.logger.warn(
            `Failed to parse node URL "${urlToUse}", falling back to localhost: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    const result = await this.capabilityDetector.detectCapabilities(id, nodeIp);

    const tests = {
      networkConnection: {
        status: 'success' as const,
        message: `Latency: ${result.latencyMs}ms`,
        details: {
          latencyMs: result.latencyMs,
          isPrivateIP: result.isPrivateIP,
        },
      },
      sharedStorage: {
        status: result.hasSharedStorage ? ('success' as const) : ('warning' as const),
        message: result.hasSharedStorage
          ? `Accessible at ${result.storageBasePath}`
          : 'No shared storage access',
        details: {
          hasSharedStorage: result.hasSharedStorage,
          storageBasePath: result.storageBasePath,
        },
      },
      hardwareDetection: {
        status: 'success' as const,
        message: `Detected ${node.cpuCores || 'unknown'} cores, ${node.ramGB || 'unknown'}GB RAM`,
        details: { cpuCores: node.cpuCores, ramGB: node.ramGB },
      },
      networkType: {
        status: 'success' as const,
        message: `Classified as ${result.networkLocation}`,
        details: { networkLocation: result.networkLocation },
      },
    };

    return {
      nodeId: id,
      nodeName: node.name,
      ...result,
      tests,
    };
  }

  // --- Node update (kept in facade — uses nodeRepository + validation) ---

  async update(id: string, data: UpdateNodeDto): Promise<Node> {
    const node = await this.nodeRepository.findById(id);

    if (!node) {
      throw new NotFoundException(`Node with ID ${id} not found`);
    }

    if (data.maxWorkers !== undefined) {
      const cpuCores = os.cpus().length;
      const optimalConfig = calculateOptimalWorkers(cpuCores, node.acceleration);

      if (data.maxWorkers > optimalConfig.recommendedMaxWorkers * 2) {
        throw new BadRequestException(
          `Setting ${data.maxWorkers} workers is too high for your ${cpuCores}-core system! ` +
            `Recommended maximum: ${optimalConfig.recommendedMaxWorkers} workers (${optimalConfig.cpuCoresPerJob} cores per job). ` +
            `Setting too many workers will cause job failures due to resource starvation. ` +
            `Estimated load: ${data.maxWorkers * optimalConfig.cpuCoresPerJob} (your system has ${cpuCores} cores).`
        );
      }

      if (data.maxWorkers > optimalConfig.recommendedMaxWorkers) {
        this.logger.warn(
          `Node ${id}: maxWorkers (${data.maxWorkers}) is higher than recommended (${optimalConfig.recommendedMaxWorkers}). ` +
            `This may cause resource contention and job failures.`
        );
      }
    }

    return this.nodeRepository.updateData(id, {
      ...(data.name && { name: data.name }),
      ...(data.maxWorkers !== undefined && { maxWorkers: data.maxWorkers }),
      ...(data.cpuLimit !== undefined && { cpuLimit: data.cpuLimit }),
      ...(data.publicUrl !== undefined && { publicUrl: data.publicUrl }),
      ...(data.mainNodeUrl !== undefined && { mainNodeUrl: data.mainNodeUrl }),
      ...(data.hasSharedStorage !== undefined && {
        hasSharedStorage: data.hasSharedStorage,
      }),
      ...(data.networkLocation !== undefined && {
        networkLocation: data.networkLocation,
      }),
      ...(data.loadThresholdMultiplier !== undefined && {
        loadThresholdMultiplier: data.loadThresholdMultiplier,
      }),
      ...(data.ipAddress && { ipAddress: data.ipAddress }),
    });
  }
}
