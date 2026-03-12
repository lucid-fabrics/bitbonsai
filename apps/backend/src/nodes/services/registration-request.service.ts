import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AccelerationType,
  ContainerType,
  type NodeRegistrationRequest,
  NodeRole,
  RegistrationRequestStatus,
} from '@prisma/client';

interface NodeRegistrationRequestWithApiKey extends NodeRegistrationRequest {
  apiKey?: string;
}

import { randomBytes } from 'crypto';
import * as os from 'os';
import { NotificationsGateway } from '../../notifications/notifications.gateway';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  NotificationPriority,
  NotificationType,
} from '../../notifications/types/notification.types';
import { PrismaService } from '../../prisma/prisma.service';
import { NodeCapabilityDetectorService } from './node-capability-detector.service';
import { SshKeyService } from './ssh-key.service';
import { StorageShareService } from './storage-share.service';
import { SystemInfoService } from './system-info.service';

export interface CreateRegistrationRequestDto {
  mainNodeId: string;
  childNodeName: string;
  message?: string;
  // System information from CHILD node
  ipAddress: string;
  hostname: string;
  macAddress?: string | null;
  subnet?: string | null;
  containerType: ContainerType;
  hardwareSpecs: {
    cpuCores: number;
    cpuModel: string;
    ramGb: number;
    diskGb: number;
    gpuModel: string | null;
  };
  acceleration: AccelerationType;
}

export interface ApproveRequestDto {
  maxWorkers?: number;
  cpuLimit?: number;
}

export interface RejectRequestDto {
  reason: string;
}

/**
 * Service to manage node registration requests
 * Handles the pending approval queue and TTL management
 */
@Injectable()
export class RegistrationRequestService {
  private readonly logger = new Logger(RegistrationRequestService.name);
  private readonly TTL_HOURS = 24;

  constructor(
    private readonly prisma: PrismaService,
    readonly _systemInfoService: SystemInfoService,
    private readonly capabilityDetector: NodeCapabilityDetectorService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly sshKeyService: SshKeyService,
    private readonly storageShareService: StorageShareService
  ) {}

  /**
   * Create a new registration request from a CHILD node
   * If a request from the same MAC address exists, reset its TTL
   * System information is now provided by the CHILD node in the DTO
   */
  async createRegistrationRequest(
    data: CreateRegistrationRequestDto
  ): Promise<NodeRegistrationRequest> {
    // System information is now provided by the CHILD node in the DTO
    // No longer collecting it on the MAIN node

    // Check if a pending request already exists from this machine
    if (data.macAddress) {
      const existingRequest = await this.prisma.nodeRegistrationRequest.findFirst({
        where: {
          mainNodeId: data.mainNodeId,
          macAddress: data.macAddress,
          status: RegistrationRequestStatus.PENDING,
        },
      });

      if (existingRequest) {
        this.logger.log(
          `🔄 Resetting TTL for existing request from ${data.hostname} (${data.macAddress})`
        );
        return this.resetRequestTTL(existingRequest.id);
      }
    }

    // Generate pairing token
    const pairingToken = this.generatePairingToken();
    const tokenExpiresAt = new Date(Date.now() + this.TTL_HOURS * 60 * 60 * 1000);

    // Get app version
    const childVersion = process.env.APP_VERSION || '1.0.0';

    // Create new registration request using system info from CHILD node
    const request = await this.prisma.nodeRegistrationRequest.create({
      data: {
        mainNodeId: data.mainNodeId,
        childNodeName: data.childNodeName,
        childVersion,
        ipAddress: data.ipAddress,
        hostname: data.hostname,
        containerType: data.containerType,
        hardwareSpecs: data.hardwareSpecs,
        acceleration: data.acceleration,
        macAddress: data.macAddress,
        subnet: data.subnet,
        pairingToken,
        tokenExpiresAt,
        message: data.message,
      },
    });

    this.logger.log(
      `📨 Registration request created: ${data.hostname} (${data.ipAddress}) → MAIN node (Token: ${pairingToken}, Expires: ${tokenExpiresAt.toISOString()})`
    );

    // Emit NODE_REGISTRATION_REQUEST notification
    const notification = await this.notificationsService.createNotification({
      type: NotificationType.NODE_REGISTRATION_REQUEST,
      priority: NotificationPriority.HIGH,
      title: `🔔 New Node Registration Request`,
      message: `${data.childNodeName} (${data.ipAddress}) wants to join the cluster. Review and approve the request.`,
      data: {
        requestId: request.id,
        childNodeName: data.childNodeName,
        ipAddress: data.ipAddress,
        hostname: data.hostname,
      },
    });
    this.notificationsGateway.sendToAll(notification);

    return request;
  }

  /**
   * Reset TTL for an existing registration request (24h from now)
   */
  async resetRequestTTL(requestId: string): Promise<NodeRegistrationRequest> {
    const newExpiresAt = new Date(Date.now() + this.TTL_HOURS * 60 * 60 * 1000);

    const request = await this.prisma.nodeRegistrationRequest.update({
      where: { id: requestId },
      data: {
        tokenExpiresAt: newExpiresAt,
        tokenGeneratedAt: new Date(),
        requestedAt: new Date(), // Reset requested timestamp too
        status: RegistrationRequestStatus.PENDING, // Reset status if it was expired
      },
    });

    this.logger.log(
      `⏱️  TTL reset for request ${requestId} (new expiry: ${newExpiresAt.toISOString()})`
    );

    return request;
  }

  /**
   * Get all pending registration requests for a MAIN node
   */
  async getPendingRequests(mainNodeId: string): Promise<NodeRegistrationRequest[]> {
    return this.prisma.nodeRegistrationRequest.findMany({
      where: {
        mainNodeId,
        status: RegistrationRequestStatus.PENDING,
        tokenExpiresAt: { gt: new Date() }, // Not expired
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * Get a specific registration request by ID
   */
  async getRequest(requestId: string): Promise<NodeRegistrationRequest> {
    const request = await this.prisma.nodeRegistrationRequest.findUnique({
      where: { id: requestId },
      include: { mainNode: true },
    });

    if (!request) {
      throw new NotFoundException(`Registration request ${requestId} not found`);
    }

    // If request is APPROVED, fetch the child node's API key
    if (request.status === RegistrationRequestStatus.APPROVED && request.childNodeId) {
      const childNode = await this.prisma.node.findUnique({
        where: { id: request.childNodeId },
        select: { apiKey: true },
      });

      if (childNode) {
        // Include the API key in the response for the child node to use
        return {
          ...request,
          apiKey: childNode.apiKey,
        } as NodeRegistrationRequestWithApiKey;
      }
    }

    return request;
  }

  /**
   * Get a registration request by pairing token
   */
  async getRequestByToken(pairingToken: string): Promise<NodeRegistrationRequest> {
    const request = await this.prisma.nodeRegistrationRequest.findUnique({
      where: { pairingToken },
      include: { mainNode: true },
    });

    if (!request) {
      throw new NotFoundException(`Invalid pairing token`);
    }

    // Check if expired
    if (request.tokenExpiresAt < new Date()) {
      throw new BadRequestException(`Pairing token has expired`);
    }

    return request as NodeRegistrationRequest;
  }

  /**
   * Approve a registration request and create the CHILD node
   *
   * RACE CONDITION FIX: Uses transaction with atomic status check to prevent
   * multiple simultaneous approvals of the same request
   */
  async approveRequest(
    requestId: string,
    approveDto?: ApproveRequestDto
  ): Promise<NodeRegistrationRequest> {
    // RACE CONDITION FIX: Move all validation and creation inside transaction
    // This prevents race conditions where multiple approval requests arrive simultaneously
    const result = await this.prisma.$transaction(async (tx) => {
      // Fetch request within transaction to get latest state
      const request = await tx.nodeRegistrationRequest.findUnique({
        where: { id: requestId },
        include: { mainNode: true },
      });

      if (!request) {
        throw new NotFoundException(`Registration request ${requestId} not found`);
      }

      // Validate request is in PENDING state (atomic check)
      if (request.status !== RegistrationRequestStatus.PENDING) {
        throw new BadRequestException(
          `Request is not in PENDING state (current: ${request.status})`
        );
      }

      // Check if expired
      if (request.tokenExpiresAt < new Date()) {
        throw new BadRequestException(`Request has expired`);
      }

      // Get MAIN node's license (within transaction)
      const mainNode = await tx.node.findUnique({
        where: { id: request.mainNodeId },
        include: {
          license: {
            include: {
              _count: { select: { nodes: true } },
            },
          },
        },
      });

      if (!mainNode) {
        throw new NotFoundException(`MAIN node ${request.mainNodeId} not found`);
      }

      // Check license node limit
      if (mainNode.license._count.nodes >= mainNode.license.maxNodes) {
        throw new ConflictException(
          `Maximum nodes (${mainNode.license.maxNodes}) reached for this license`
        );
      }

      // DUPLICATE PREVENTION: Check if a node with this IP or MAC address already exists
      const duplicateNode = await tx.node.findFirst({
        where: {
          role: NodeRole.LINKED,
          OR: [
            { ipAddress: request.ipAddress },
            ...(request.macAddress
              ? [
                  {
                    id: {
                      in: await tx.nodeRegistrationRequest
                        .findMany({
                          where: {
                            macAddress: request.macAddress,
                            status: RegistrationRequestStatus.APPROVED,
                            childNodeId: { not: null },
                          },
                          select: { childNodeId: true },
                        })
                        .then((reqs) => reqs.map((r) => r.childNodeId).filter(Boolean) as string[]),
                    },
                  },
                ]
              : []),
          ],
        },
      });

      if (duplicateNode) {
        throw new ConflictException(
          `A child node with IP address ${request.ipAddress} already exists (Node: "${duplicateNode.name}", ID: ${duplicateNode.id}). Please remove the existing node first or use a different child node.`
        );
      }

      // Detect node capabilities before creating the node
      this.logger.log('🔍 Detecting node capabilities...');
      const capabilities = await this.capabilityDetector.detectCapabilities(
        request.id, // Use request ID temporarily
        request.ipAddress
      );

      this.logger.log(`📊 Capabilities detected: ${JSON.stringify(capabilities, null, 2)}`);

      // Extract hardware specs from request
      const hardwareSpecs = request.hardwareSpecs as Record<string, unknown>;
      const cpuCores = (hardwareSpecs?.cpuCores as number) || os.cpus().length;
      const ramGB = (hardwareSpecs?.ramGb as number) || Math.round(os.totalmem() / 1024 ** 3);

      // Create CHILD node with capability data
      const newNode = await tx.node.create({
        data: {
          name: request.childNodeName,
          role: NodeRole.LINKED,
          status: 'ONLINE',
          version: request.childVersion,
          acceleration: request.acceleration,
          apiKey: this.generateApiKey(),
          lastHeartbeat: new Date(),
          maxWorkers: approveDto?.maxWorkers || 2,
          cpuLimit: approveDto?.cpuLimit || 80,
          licenseId: mainNode.licenseId,
          // Hybrid architecture fields
          networkLocation: capabilities.networkLocation,
          hasSharedStorage: capabilities.hasSharedStorage,
          storageBasePath: capabilities.storageBasePath,
          ipAddress: request.ipAddress, // Store IP for future capability tests
          latencyMs: capabilities.latencyMs,
          cpuCores,
          ramGB,
        },
      });

      // Update request status atomically
      const updatedReq = await tx.nodeRegistrationRequest.update({
        where: { id: requestId },
        data: {
          status: RegistrationRequestStatus.APPROVED,
          respondedAt: new Date(),
          childNodeId: newNode.id,
        },
      });

      return { request, newNode, updatedReq };
    });

    this.logger.log(
      `✅ Registration request approved: ${result.request.childNodeName} (${result.request.ipAddress}) → Node ID: ${result.newNode.id}`
    );

    // SSH KEY EXCHANGE: Setup passwordless authentication for file transfers
    let mainNodePublicKey: string | undefined;
    if (result.request.sshPublicKey) {
      try {
        this.logger.log('🔑 Setting up SSH keys for passwordless file transfers...');

        // Add CHILD's public key to MAIN's authorized_keys
        this.sshKeyService.addAuthorizedKey(
          result.request.sshPublicKey,
          `bitbonsai-child-${result.newNode.id}`
        );

        // Get MAIN's public key to send to CHILD
        mainNodePublicKey = this.sshKeyService.getPublicKey();

        this.logger.log('✅ SSH keys exchanged successfully');
      } catch (error) {
        this.logger.error('Failed to setup SSH keys:', error);
        // Don't fail the approval if SSH setup fails - it can be done manually
      }
    }

    // AUTOMATIC STORAGE SETUP: Create storage shares for main node's libraries
    // so child nodes can auto-detect and mount them
    try {
      this.logger.log('🗄️  Setting up automatic storage sharing for new child node...');

      // Get the main node ID
      const mainNode = await this.prisma.node.findFirst({
        where: { role: NodeRole.MAIN },
      });

      if (mainNode) {
        // Create storage shares for all main node libraries
        const shares = await this.storageShareService.autoCreateSharesForLibraries(mainNode.id);

        if (shares.length > 0) {
          this.logger.log(`✅ Created ${shares.length} storage shares for child node to access`);

          // Update child node's hasSharedStorage flag if shares were created
          await this.prisma.node.update({
            where: { id: result.newNode.id },
            data: { hasSharedStorage: true },
          });

          this.logger.log(`✅ Child node marked as having shared storage access`);
        } else {
          this.logger.warn(
            'No storage shares created - main node may not have any libraries configured yet'
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to setup automatic storage:', error);
      // Don't fail the approval if storage setup fails - it can be done manually
    }

    // Emit NODE_APPROVED notification
    const notification = await this.notificationsService.createNotification({
      type: NotificationType.NODE_APPROVED,
      priority: NotificationPriority.MEDIUM,
      title: `💪 Node Approved!`,
      message: `${result.request.childNodeName} is now ready to crush some encoding work! Welcome to the cluster.`,
      data: {
        nodeId: result.newNode.id,
        nodeName: result.request.childNodeName,
        ipAddress: result.request.ipAddress,
      },
    });
    this.notificationsGateway.sendToAll(notification);

    // Return the updated request with the child node's API key and ID included
    // This is needed for the child node to authenticate future requests
    // and for the frontend to fetch capability results
    return {
      ...result.updatedReq,
      apiKey: result.newNode.apiKey,
      nodeId: result.newNode.id, // Add nodeId for frontend capability detection
      mainNodePublicKey, // SSH public key for CHILD to add to its authorized_keys
    } as NodeRegistrationRequest;
  }

  /**
   * Reject a registration request
   */
  async rejectRequest(
    requestId: string,
    rejectDto: RejectRequestDto
  ): Promise<NodeRegistrationRequest> {
    const request = await this.getRequest(requestId);

    // Validate request is in PENDING state
    if (request.status !== RegistrationRequestStatus.PENDING) {
      throw new BadRequestException(`Request is not in PENDING state (current: ${request.status})`);
    }

    const updatedRequest = await this.prisma.nodeRegistrationRequest.update({
      where: { id: requestId },
      data: {
        status: RegistrationRequestStatus.REJECTED,
        respondedAt: new Date(),
        rejectionReason: rejectDto.reason,
      },
    });

    this.logger.log(
      `❌ Registration request rejected: ${request.childNodeName} (${request.ipAddress}) - Reason: ${rejectDto.reason}`
    );

    return updatedRequest;
  }

  /**
   * Cancel a pending registration request (called by CHILD node)
   */
  async cancelRequest(requestId: string): Promise<NodeRegistrationRequest> {
    const request = await this.getRequest(requestId);

    // Only allow cancelling PENDING requests
    if (request.status !== RegistrationRequestStatus.PENDING) {
      throw new BadRequestException(
        `Can only cancel PENDING requests (current: ${request.status})`
      );
    }

    const updatedRequest = await this.prisma.nodeRegistrationRequest.update({
      where: { id: requestId },
      data: {
        status: RegistrationRequestStatus.CANCELLED,
        respondedAt: new Date(),
      },
    });

    this.logger.log(
      `🚫 Registration request cancelled: ${request.childNodeName} (${request.ipAddress})`
    );

    return updatedRequest;
  }

  /**
   * Cancel a request by pairing token (alternative method for CHILD nodes)
   */
  async cancelRequestByToken(pairingToken: string): Promise<NodeRegistrationRequest> {
    const request = await this.getRequestByToken(pairingToken);
    return this.cancelRequest(request.id);
  }

  /**
   * Cleanup expired registration requests
   * Runs every hour to mark expired requests
   */
  @Cron('0 * * * *') // Every hour at minute 0
  async cleanupExpiredRequests(): Promise<void> {
    try {
      const now = new Date();

      const result = await this.prisma.nodeRegistrationRequest.updateMany({
        where: {
          status: RegistrationRequestStatus.PENDING,
          tokenExpiresAt: { lt: now },
        },
        data: {
          status: RegistrationRequestStatus.EXPIRED,
        },
      });

      if (result.count > 0) {
        this.logger.log(`🧹 Marked ${result.count} expired registration request(s)`);
      }
    } catch (error) {
      this.logger.error('Failed to cleanup expired requests', error);
    }
  }

  /**
   * Delete old registration requests (older than 30 days)
   * Runs daily at 3 AM
   */
  @Cron('0 3 * * *') // Daily at 3 AM
  async deleteOldRequests(): Promise<void> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const result = await this.prisma.nodeRegistrationRequest.deleteMany({
        where: {
          createdAt: { lt: thirtyDaysAgo },
          status: {
            in: [
              RegistrationRequestStatus.APPROVED,
              RegistrationRequestStatus.REJECTED,
              RegistrationRequestStatus.EXPIRED,
              RegistrationRequestStatus.CANCELLED,
            ],
          },
        },
      });

      if (result.count > 0) {
        this.logger.log(`🗑️  Deleted ${result.count} old registration request(s)`);
      }
    } catch (error) {
      this.logger.error('Failed to delete old requests', error);
    }
  }

  /**
   * Generate a 6-digit numeric pairing token
   */
  private generatePairingToken(): string {
    // Generate random 6-digit number (100000-999999)
    const min = 100000;
    const max = 999999;
    const randomNum = min + Math.floor(Math.random() * (max - min + 1));
    return randomNum.toString();
  }

  /**
   * Generate a secure API key for node authentication
   */
  private generateApiKey(): string {
    return `bb_${randomBytes(48).toString('hex')}`;
  }
}
