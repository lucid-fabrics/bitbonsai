import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { type Job, JobStage, type Node, NodeRole } from '@prisma/client';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { NodeConfigService } from './node-config.service';

/**
 * DataAccessService
 *
 * Provides a unified abstraction layer for data access that works for both MAIN and LINKED nodes.
 *
 * - MAIN nodes: Use Prisma directly to access local SQLite database (existing behavior)
 * - LINKED nodes: Call MAIN node's HTTP API for all data operations
 *
 * This service automatically detects the node role from the database (via NodeConfigService)
 * and routes all data operations appropriately.
 *
 * Configuration is loaded from the database, NOT from environment variables.
 */
@Injectable()
export class DataAccessService {
  private readonly logger = new Logger(DataAccessService.name);

  constructor(
    readonly _prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly nodeConfig: NodeConfigService
  ) {
    // Configuration is now loaded from database via NodeConfigService
    // No synchronous initialization needed - config is fetched on-demand
    this.logger.log('🔧 [DataAccessService] Initialized with database-driven configuration');
  }

  /**
   * Get the current node's role from NodeConfigService
   */
  private get nodeRole(): NodeRole | null {
    return this.nodeConfig.getRole();
  }

  /**
   * Get the main API URL from NodeConfigService
   */
  private get mainApiUrl(): string | null {
    return this.nodeConfig.getMainApiUrl();
  }

  /**
   * Get the next available job for a node to process
   *
   * MAIN mode: Calls QueueService.getNextJob() via Prisma
   * LINKED mode: Calls GET /queue/next-job?nodeId={id} on MAIN node
   *
   * @param nodeId - Node unique identifier
   * @returns Next job to process, or null if none available
   */
  async getNextJob(nodeId: string): Promise<Job | null> {
    if (this.nodeRole === 'MAIN') {
      // MAIN mode: Direct Prisma access (via QueueService in the caller)
      // This method is a pass-through - actual implementation is in the caller
      throw new Error(
        'getNextJob should not be called directly on MAIN nodes - use QueueService.getNextJob() instead'
      );
    }

    // LINKED mode: Call MAIN node's API
    try {
      this.logger.debug(`[LINKED] Getting next job for node ${nodeId} from MAIN API`);

      const response: AxiosResponse<Job | null> = await firstValueFrom(
        this.httpService.get<Job | null>(`${this.mainApiUrl}/api/v1/queue/next-job`, {
          params: { nodeId },
          timeout: 10000, // 10 second timeout
        })
      );

      const job = response.data || null;

      if (job) {
        this.logger.log(
          `[LINKED] Received job ${job.id} (${job.fileLabel}) from MAIN API for node ${nodeId}`
        );
      } else {
        this.logger.debug(`[LINKED] No jobs available from MAIN API for node ${nodeId}`);
      }

      return job;
    } catch (error) {
      this.logger.error(
        `[LINKED] Failed to get next job from MAIN API: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      throw error;
    }
  }

  /**
   * Update job progress (percentage and ETA)
   *
   * MAIN mode: Updates Prisma directly via QueueService
   * LINKED mode: Calls PATCH /queue/:jobId/progress on MAIN node
   *
   * @param jobId - Job unique identifier
   * @param progress - Current completion percentage (0-100)
   * @param etaSeconds - Estimated time to completion in seconds
   */
  async updateJobProgress(jobId: string, progress: number, etaSeconds: number): Promise<void> {
    if (this.nodeRole === 'MAIN') {
      // MAIN mode: Pass-through to caller's QueueService
      throw new Error(
        'updateJobProgress should not be called directly on MAIN nodes - use QueueService.updateProgress() instead'
      );
    }

    // LINKED mode: Call MAIN node's API
    try {
      this.logger.debug(
        `[LINKED] Updating job ${jobId} progress to ${progress.toFixed(1)}% (ETA: ${etaSeconds}s)`
      );

      await firstValueFrom(
        this.httpService.patch(
          `${this.mainApiUrl}/api/v1/queue/${jobId}/progress`,
          {
            progress,
            etaSeconds,
          },
          {
            timeout: 5000, // 5 second timeout
          }
        )
      );

      this.logger.debug(`[LINKED] Successfully updated job ${jobId} progress on MAIN API`);
    } catch (error) {
      this.logger.error(
        `[LINKED] Failed to update job progress on MAIN API: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      // Don't throw - progress updates are not critical, we don't want to fail the entire job
    }
  }

  /**
   * Update job stage
   *
   * MAIN mode: Updates Prisma directly via QueueService
   * LINKED mode: Calls PATCH /queue/:jobId/stage on MAIN node
   *
   * @param jobId - Job unique identifier
   * @param stage - New job stage
   * @param data - Optional stage-specific data
   */
  async updateJobStage(jobId: string, stage: JobStage, data?: any): Promise<void> {
    if (this.nodeRole === 'MAIN') {
      // MAIN mode: Pass-through to caller's QueueService
      throw new Error(
        'updateJobStage should not be called directly on MAIN nodes - use QueueService.updateProgress() instead'
      );
    }

    // LINKED mode: Call MAIN node's API
    try {
      this.logger.debug(`[LINKED] Updating job ${jobId} stage to ${stage}`);

      await firstValueFrom(
        this.httpService.patch(
          `${this.mainApiUrl}/api/v1/queue/${jobId}/stage`,
          {
            stage,
            ...data,
          },
          {
            timeout: 5000, // 5 second timeout
          }
        )
      );

      this.logger.log(`[LINKED] Successfully updated job ${jobId} stage to ${stage} on MAIN API`);
    } catch (error) {
      this.logger.error(
        `[LINKED] Failed to update job stage on MAIN API: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      throw error;
    }
  }

  /**
   * Send heartbeat for a node
   *
   * MAIN mode: Updates Prisma directly via NodesService
   * LINKED mode: Calls POST /nodes/:id/heartbeat on MAIN node
   *
   * @param nodeId - Node unique identifier
   */
  async sendHeartbeat(nodeId: string): Promise<void> {
    if (this.nodeRole === 'MAIN') {
      // MAIN mode: Pass-through to caller's NodesService
      throw new Error(
        'sendHeartbeat should not be called directly on MAIN nodes - use NodesService.heartbeat() instead'
      );
    }

    // LINKED mode: Call MAIN node's API
    try {
      this.logger.debug(`[LINKED] Sending heartbeat for node ${nodeId} to MAIN API`);

      // Detect this node's IP address to send to main node
      // This ensures the main node updates the correct IP for this child node
      const systemInfo = await this.detectLocalSystemInfo();
      const ipAddress = systemInfo?.ipAddress;

      await firstValueFrom(
        this.httpService.post(
          `${this.mainApiUrl}/api/v1/nodes/${nodeId}/heartbeat`,
          {
            ipAddress, // Send this node's IP address so main node can update it correctly
          },
          {
            timeout: 5000, // 5 second timeout
          }
        )
      );

      this.logger.debug(`[LINKED] Successfully sent heartbeat for node ${nodeId} to MAIN API`);
    } catch (error) {
      this.logger.error(
        `[LINKED] Failed to send heartbeat to MAIN API: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      // Don't throw - heartbeat failures are not critical
    }
  }

  /**
   * Detect local system info (IP address, etc.) for this node
   * Used by LINKED nodes to send their IP to the main node
   */
  private async detectLocalSystemInfo(): Promise<{ ipAddress: string } | null> {
    try {
      const os = await import('os');
      const interfaces = os.networkInterfaces();

      // Find first non-internal IPv4 address
      for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;

        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal) {
            this.logger.debug(`[LINKED] Detected local IP address: ${addr.address} on ${name}`);
            return { ipAddress: addr.address };
          }
        }
      }

      this.logger.warn('[LINKED] No external IP found');
      return null;
    } catch (error) {
      this.logger.error('[LINKED] Failed to detect local IP', error);
      return null;
    }
  }

  /**
   * Get node information
   *
   * MAIN mode: Queries Prisma directly via NodesService
   * LINKED mode: Calls GET /nodes/:id on MAIN node
   *
   * @param nodeId - Node unique identifier
   * @returns Node information
   */
  async getNode(nodeId: string): Promise<Node> {
    if (this.nodeRole === 'MAIN') {
      // MAIN mode: Pass-through to caller's NodesService
      throw new Error(
        'getNode should not be called directly on MAIN nodes - use NodesService.findOne() instead'
      );
    }

    // LINKED mode: Call MAIN node's API
    try {
      this.logger.debug(`[LINKED] Getting node ${nodeId} info from MAIN API`);

      const response: AxiosResponse<Node> = await firstValueFrom(
        this.httpService.get<Node>(`${this.mainApiUrl}/api/v1/nodes/${nodeId}`, {
          timeout: 5000, // 5 second timeout
        })
      );

      this.logger.debug(`[LINKED] Successfully retrieved node ${nodeId} info from MAIN API`);
      return response.data;
    } catch (error) {
      this.logger.error(
        `[LINKED] Failed to get node info from MAIN API: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      throw error;
    }
  }

  /**
   * Check if this instance is running in LINKED mode
   *
   * @returns true if running in LINKED mode, false if MAIN mode
   */
  isLinkedMode(): boolean {
    return this.nodeConfig.isLinkedNode();
  }

  /**
   * Check if this instance is running in MAIN mode
   *
   * @returns true if running in MAIN mode, false if LINKED mode
   */
  isMainMode(): boolean {
    return this.nodeConfig.isMainNode();
  }

  /**
   * Get the node role
   *
   * @returns 'MAIN' or 'LINKED'
   */
  getNodeRole(): 'MAIN' | 'LINKED' | null {
    return this.nodeConfig.getRole();
  }

  /**
   * Get the MAIN API URL (only applicable for LINKED nodes)
   *
   * @returns MAIN API URL or null if running in MAIN mode
   */
  getMainApiUrl(): string | null {
    return this.nodeConfig.getMainApiUrl();
  }
}
