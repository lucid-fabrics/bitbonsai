import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Node } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { HeartbeatDto } from './dto/heartbeat.dto';
import type { NodeRegistrationResponseDto } from './dto/node-registration-response.dto';
import type { NodeStatsDto } from './dto/node-stats.dto';
import type { RegisterNodeDto } from './dto/register-node.dto';

/**
 * NodesService
 *
 * Handles node registration, pairing, heartbeat tracking, and statistics.
 * Implements multi-node architecture with license validation and pairing mechanism.
 */
@Injectable()
export class NodesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Register a new node with license validation
   *
   * Process:
   * 1. Validate license key and check if active
   * 2. Verify node limit hasn't been reached
   * 3. Assign role (MAIN for first node, LINKED for additional)
   * 4. Generate unique API key for node authentication
   * 5. Generate 6-digit pairing token (expires in 10 minutes)
   * 6. Create node record in database
   *
   * @param data Registration data (name, licenseKey, version, acceleration)
   * @returns Node with apiKey and pairingToken (only shown once)
   * @throws BadRequestException if license is invalid or inactive
   * @throws ConflictException if maximum nodes reached for license
   */
  async registerNode(data: RegisterNodeDto): Promise<NodeRegistrationResponseDto> {
    // Validate license
    const license = await this.prisma.license.findUnique({
      where: { key: data.licenseKey },
      include: {
        _count: {
          select: { nodes: true },
        },
      },
    });

    if (!license || license.status !== 'ACTIVE') {
      throw new BadRequestException('Invalid or inactive license key');
    }

    if (license._count.nodes >= license.maxNodes) {
      throw new ConflictException(`Maximum nodes (${license.maxNodes}) reached for this license`);
    }

    // Generate pairing token (6-digit code, expires in 10 minutes)
    const pairingToken = this.generatePairingToken();
    const pairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create node
    const node = await this.prisma.node.create({
      data: {
        name: data.name,
        role: license._count.nodes === 0 ? 'MAIN' : 'LINKED',
        status: 'ONLINE',
        version: data.version,
        acceleration: data.acceleration,
        apiKey: this.generateApiKey(),
        pairingToken,
        pairingExpiresAt,
        lastHeartbeat: new Date(),
        licenseId: license.id,
      },
    });

    return {
      id: node.id,
      name: node.name,
      role: node.role,
      status: node.status,
      version: node.version,
      acceleration: node.acceleration,
      apiKey: node.apiKey,
      pairingToken: node.pairingToken || '',
      pairingExpiresAt: node.pairingExpiresAt || new Date(),
      createdAt: node.createdAt,
    };
  }

  /**
   * Complete node pairing using 6-digit token
   *
   * Process:
   * 1. Find node with matching pairing token
   * 2. Verify token hasn't expired (10 minute window)
   * 3. Clear pairing token and expiration (pairing complete)
   * 4. Return node details
   *
   * @param pairingToken 6-digit pairing code
   * @returns Paired node details
   * @throws NotFoundException if token is invalid or expired
   */
  async pairNode(pairingToken: string): Promise<Node> {
    const node = await this.prisma.node.findFirst({
      where: {
        pairingToken,
        pairingExpiresAt: {
          gte: new Date(), // Token must not be expired
        },
      },
    });

    if (!node) {
      throw new NotFoundException('Invalid or expired pairing token');
    }

    // Clear pairing token (pairing complete)
    return this.prisma.node.update({
      where: { id: node.id },
      data: {
        pairingToken: null,
        pairingExpiresAt: null,
      },
    });
  }

  /**
   * Generate a new pairing token for an existing node
   *
   * Use case: If original pairing token expired, generate a new one
   *
   * @param nodeId Node identifier
   * @returns Updated node with new pairing token
   * @throws NotFoundException if node doesn't exist
   */
  async generatePairingTokenForNode(nodeId: string): Promise<NodeRegistrationResponseDto> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });

    if (!node) {
      throw new NotFoundException(`Node with ID ${nodeId} not found`);
    }

    const pairingToken = this.generatePairingToken();
    const pairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const updated = await this.prisma.node.update({
      where: { id: nodeId },
      data: {
        pairingToken,
        pairingExpiresAt,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      role: updated.role,
      status: updated.status,
      version: updated.version,
      acceleration: updated.acceleration,
      apiKey: updated.apiKey,
      pairingToken: updated.pairingToken || '',
      pairingExpiresAt: updated.pairingExpiresAt || new Date(),
      createdAt: updated.createdAt,
    };
  }

  /**
   * Record node heartbeat and update statistics
   *
   * Process:
   * 1. Update lastHeartbeat timestamp
   * 2. Increment uptimeSeconds (assumes 60s heartbeat interval)
   * 3. Update status if provided
   * 4. Update CPU/memory usage if provided
   *
   * @param nodeId Node identifier
   * @param data Optional status and metrics
   * @returns Updated node
   * @throws NotFoundException if node doesn't exist
   */
  async heartbeat(nodeId: string, data?: HeartbeatDto): Promise<Node> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });

    if (!node) {
      throw new NotFoundException(`Node with ID ${nodeId} not found`);
    }

    return this.prisma.node.update({
      where: { id: nodeId },
      data: {
        status: data?.status || 'ONLINE',
        lastHeartbeat: new Date(),
        uptimeSeconds: { increment: 60 }, // Assuming 60s heartbeat interval
      },
    });
  }

  /**
   * Get node with comprehensive statistics
   *
   * Includes:
   * - Node details
   * - Associated license information
   * - List of managed libraries
   * - Count of active encoding jobs (QUEUED, ENCODING, VERIFYING)
   *
   * @param nodeId Node identifier
   * @returns Node with statistics
   * @throws NotFoundException if node doesn't exist
   */
  async getNodeStats(nodeId: string): Promise<NodeStatsDto> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: {
        license: {
          select: {
            tier: true,
            maxConcurrentJobs: true,
            maxNodes: true,
            status: true,
          },
        },
        libraries: {
          select: {
            id: true,
            name: true,
            totalFiles: true,
            totalSizeBytes: true,
            mediaType: true,
          },
        },
        _count: {
          select: {
            jobs: {
              where: {
                stage: { in: ['QUEUED', 'ENCODING', 'VERIFYING'] },
              },
            },
          },
        },
      },
    });

    if (!node) {
      throw new NotFoundException(`Node with ID ${nodeId} not found`);
    }

    return {
      id: node.id,
      name: node.name,
      role: node.role,
      status: node.status,
      version: node.version,
      acceleration: node.acceleration,
      lastHeartbeat: node.lastHeartbeat,
      uptimeSeconds: node.uptimeSeconds,
      createdAt: node.createdAt,
      license: node.license,
      libraries: node.libraries,
      activeJobCount: node._count.jobs,
    };
  }

  /**
   * Get all nodes with basic information
   *
   * @returns List of all nodes
   */
  async findAll(): Promise<Node[]> {
    return this.prisma.node.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Get a specific node by ID
   *
   * @param id Node identifier
   * @returns Node details
   * @throws NotFoundException if node doesn't exist
   */
  async findOne(id: string): Promise<Node> {
    const node = await this.prisma.node.findUnique({
      where: { id },
    });

    if (!node) {
      throw new NotFoundException(`Node with ID ${id} not found`);
    }

    return node;
  }

  /**
   * Remove a node from the system
   *
   * Warning: This will cascade delete all associated libraries and jobs
   *
   * @param id Node identifier
   * @throws NotFoundException if node doesn't exist
   */
  async remove(id: string): Promise<void> {
    const node = await this.prisma.node.findUnique({
      where: { id },
    });

    if (!node) {
      throw new NotFoundException(`Node with ID ${id} not found`);
    }

    await this.prisma.node.delete({
      where: { id },
    });
  }

  /**
   * Generate a secure API key for node authentication
   *
   * Format: bb_[64 hex characters]
   *
   * @returns API key string
   */
  private generateApiKey(): string {
    const random = randomBytes(32).toString('hex');
    return `bb_${random}`;
  }

  /**
   * Generate a 6-digit pairing token
   *
   * Format: 000000-999999 (6 digits)
   *
   * @returns 6-digit pairing code
   */
  private generatePairingToken(): string {
    const token = Math.floor(100000 + Math.random() * 900000).toString();
    return token;
  }
}
