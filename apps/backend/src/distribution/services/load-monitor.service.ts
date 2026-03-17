import { Injectable, Logger } from '@nestjs/common';
import type { Node } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { HeartbeatLoadData, NodeCapacity } from '../interfaces/scoring-factors.interface';

/**
 * Load Monitor Service
 *
 * Tracks real-time system load for all nodes via heartbeat data.
 * Updates Node records with current load metrics for scoring.
 */
@Injectable()
export class LoadMonitorService {
  private readonly logger = new Logger(LoadMonitorService.name);

  // In-memory cache for fast access (updated by heartbeats)
  private loadCache = new Map<string, HeartbeatLoadData>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Update load data from heartbeat
   * Called by NodesService when heartbeat is received
   */
  async updateFromHeartbeat(
    nodeId: string,
    loadData: {
      load1m: number;
      load5m: number;
      load15m: number;
      memFreeGB: number;
      memTotalGB: number;
      cpuCount: number;
    }
  ): Promise<void> {
    const heartbeatData: HeartbeatLoadData = {
      ...loadData,
      timestamp: new Date(),
    };

    // Update in-memory cache
    this.loadCache.set(nodeId, heartbeatData);

    // Update database
    await this.prisma.node.update({
      where: { id: nodeId },
      data: {
        currentSystemLoad: loadData.load1m,
        currentMemoryFreeGB: loadData.memFreeGB,
        lastHeartbeatLoad: loadData as object,
      },
    });

    this.logger.debug(
      `Updated load for node ${nodeId}: load=${loadData.load1m.toFixed(2)}, mem=${loadData.memFreeGB.toFixed(1)}GB`
    );
  }

  /**
   * Get current load for a node (from cache or database)
   */
  async getNodeLoad(nodeId: string): Promise<HeartbeatLoadData | null> {
    // Check cache first
    const cached = this.loadCache.get(nodeId);
    if (cached) {
      // Check if cache is still fresh (< 2 minutes old)
      const ageMs = Date.now() - cached.timestamp.getTime();
      if (ageMs < 120000) {
        return cached;
      }
    }

    // Fetch from database
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: {
        lastHeartbeatLoad: true,
        currentSystemLoad: true,
        currentMemoryFreeGB: true,
        cpuCores: true,
      },
    });

    if (!node || !node.lastHeartbeatLoad) {
      return null;
    }

    const loadData = node.lastHeartbeatLoad as Record<string, number>;
    return {
      load1m: loadData.load1m || node.currentSystemLoad || 0,
      load5m: loadData.load5m || 0,
      load15m: loadData.load15m || 0,
      memFreeGB: loadData.memFreeGB || node.currentMemoryFreeGB || 0,
      memTotalGB: loadData.memTotalGB || 0,
      cpuCount: loadData.cpuCount || node.cpuCores || 1,
      timestamp: new Date(),
    };
  }

  /**
   * Calculate load score (0-30 points)
   * Lower load = higher score
   */
  calculateLoadScore(node: Node, loadData: HeartbeatLoadData | null): number {
    if (!loadData) {
      // No load data - give middle score
      return 15;
    }

    const cpuCount = loadData.cpuCount || node.cpuCores || 1;
    const loadThreshold = cpuCount * (node.loadThresholdMultiplier || 3.0);

    // Calculate load ratio (0 = idle, 1 = at threshold, >1 = overloaded)
    const loadRatio = Math.min(loadData.load1m / loadThreshold, 2);

    // Score: 30 points at 0% load, 0 points at 100% load or above
    const loadScore = Math.max(0, (1 - loadRatio) * 30);

    // Memory penalty: reduce score if memory is low (<4GB free)
    let memoryPenalty = 0;
    if (loadData.memFreeGB < 4) {
      memoryPenalty = (4 - loadData.memFreeGB) * 2; // Up to 8 points penalty
    }

    return Math.max(0, loadScore - memoryPenalty);
  }

  /**
   * Check if node is overloaded
   */
  isOverloaded(
    node: Node,
    loadData: HeartbeatLoadData | null
  ): { isOverloaded: boolean; reason?: string } {
    if (!loadData) {
      return { isOverloaded: false };
    }

    const cpuCount = loadData.cpuCount || node.cpuCores || 1;
    const loadThreshold = cpuCount * (node.loadThresholdMultiplier || 3.0);

    // Check CPU load
    if (loadData.load1m > loadThreshold) {
      return {
        isOverloaded: true,
        reason: `CPU load ${loadData.load1m.toFixed(1)} exceeds threshold ${loadThreshold.toFixed(1)}`,
      };
    }

    // Check memory (minimum 2GB free required)
    if (loadData.memFreeGB < 2) {
      return {
        isOverloaded: true,
        reason: `Memory ${loadData.memFreeGB.toFixed(1)}GB below minimum 2GB`,
      };
    }

    return { isOverloaded: false };
  }

  /**
   * Get capacity status for a node
   */
  async getNodeCapacity(nodeId: string): Promise<NodeCapacity | null> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: {
        id: true,
        name: true,
        role: true,
        maxWorkers: true,
        cpuCores: true,
        loadThresholdMultiplier: true,
        estimatedFreeAt: true,
        lastHeartbeatLoad: true,
        currentSystemLoad: true,
        currentMemoryFreeGB: true,
        _count: {
          select: {
            jobs: {
              where: {
                stage: { in: ['ENCODING', 'VERIFYING'] },
              },
            },
          },
        },
      },
    });

    if (!node) {
      return null;
    }

    const loadData = await this.getNodeLoad(nodeId);
    const overloadCheck = this.isOverloaded(node as unknown as Node, loadData);

    // Count queued jobs
    const queuedCount = await this.prisma.job.count({
      where: {
        nodeId,
        stage: 'QUEUED',
      },
    });

    const maxWorkers = node.maxWorkers || 1;
    const activeJobs = node._count.jobs;
    const availableSlots = Math.max(0, maxWorkers - activeJobs);

    return {
      nodeId: node.id,
      nodeName: node.name,
      role: node.role as 'MAIN' | 'LINKED',
      maxWorkers,
      activeJobs,
      queuedJobs: queuedCount,
      availableSlots,
      estimatedFreeAt: node.estimatedFreeAt,
      isOverloaded: overloadCheck.isOverloaded,
      overloadReason: overloadCheck.reason,
      // Include load metrics for UI display
      loadAvg1m: loadData?.load1m,
      cpuCount: loadData?.cpuCount ?? node.cpuCores ?? undefined,
      freeMemoryGB: loadData?.memFreeGB,
      totalMemoryGB: loadData?.memTotalGB,
    };
  }

  /**
   * Get load data for all online nodes
   */
  async getAllNodesLoad(): Promise<Map<string, HeartbeatLoadData>> {
    const nodes = await this.prisma.node.findMany({
      where: { status: 'ONLINE' },
      select: {
        id: true,
        lastHeartbeatLoad: true,
        currentSystemLoad: true,
        currentMemoryFreeGB: true,
        cpuCores: true,
      },
    });

    const result = new Map<string, HeartbeatLoadData>();

    for (const node of nodes) {
      // Check cache first
      const cached = this.loadCache.get(node.id);
      if (cached && Date.now() - cached.timestamp.getTime() < 120000) {
        result.set(node.id, cached);
        continue;
      }

      // Use database data
      if (node.lastHeartbeatLoad) {
        const loadData = node.lastHeartbeatLoad as Record<string, number>;
        result.set(node.id, {
          load1m: loadData.load1m || node.currentSystemLoad || 0,
          load5m: loadData.load5m || 0,
          load15m: loadData.load15m || 0,
          memFreeGB: loadData.memFreeGB || node.currentMemoryFreeGB || 0,
          memTotalGB: loadData.memTotalGB || 0,
          cpuCount: loadData.cpuCount || node.cpuCores || 1,
          timestamp: new Date(),
        });
      }
    }

    return result;
  }

  /**
   * Clear cache for a node (called when node goes offline)
   */
  clearNodeCache(nodeId: string): void {
    this.loadCache.delete(nodeId);
  }
}
