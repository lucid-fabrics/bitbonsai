import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { type Node, NodeRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { HeartbeatDto } from './dto/heartbeat.dto';
import type { NodeRegistrationResponseDto } from './dto/node-registration-response.dto';
import type { NodeStatsDto } from './dto/node-stats.dto';
import type { RegisterNodeDto } from './dto/register-node.dto';
import type { UpdateNodeDto } from './dto/update-node.dto';

/**
 * NodesService
 *
 * Handles node registration, pairing, heartbeat tracking, and statistics.
 * Implements multi-node architecture with license validation and pairing mechanism.
 */
@Injectable()
export class NodesService implements OnModuleInit {
  private readonly logger = new Logger(NodesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Initialize MAIN node on module startup
   */
  async onModuleInit() {
    this.logger.log('🔧 Initializing nodes service...');
    this.logger.log('💓 MAIN node auto-heartbeat started (every 30s)');

    // Send initial heartbeat immediately
    this.sendMainNodeHeartbeat();
  }

  /**
   * Auto-heartbeat for the MAIN node
   * Uses @Interval decorator for resilience to hot reloads
   * Sends heartbeat every 30 seconds to keep status updated
   */
  @Interval(30000)
  private async sendMainNodeHeartbeat(): Promise<void> {
    try {
      const mainNode = await this.prisma.node.findFirst({
        where: { role: NodeRole.MAIN },
      });

      if (!mainNode) {
        this.logger.warn('⚠️  MAIN node not found - skipping heartbeat');
        return;
      }

      await this.heartbeat(mainNode.id);
      this.logger.debug(`💓 Heartbeat sent for ${mainNode.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`❌ Failed to send MAIN node heartbeat: ${errorMessage}`);
      if (errorStack) {
        this.logger.error(errorStack);
      }
    }
  }

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
    // If no license key provided, use main node's license (for child node registration from main)
    let licenseKey = data.licenseKey;
    if (!licenseKey) {
      const mainNode = await this.prisma.node.findFirst({
        where: { role: NodeRole.MAIN },
        include: { license: true },
      });

      if (!mainNode) {
        throw new BadRequestException(
          'No main node found. License key is required for first node registration.'
        );
      }

      licenseKey = mainNode.license.key;
      this.logger.debug(`Using main node's license (${licenseKey}) for child node registration`);
    }

    // Validate license
    const license = await this.prisma.license.findUnique({
      where: { key: licenseKey },
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

    // Determine role
    const role = license._count.nodes === 0 ? NodeRole.MAIN : NodeRole.LINKED;

    // Provide intelligent defaults for optional fields
    const nodeName =
      data.name || `${role === NodeRole.MAIN ? 'Main' : 'Linked'} Node ${license._count.nodes + 1}`;
    const nodeVersion = data.version || process.env.APP_VERSION || '1.0.0';
    const nodeAcceleration = data.acceleration || 'CPU'; // Default to CPU (every node has a CPU)

    // Create node
    const node = await this.prisma.node.create({
      data: {
        name: nodeName,
        role,
        status: 'ONLINE',
        version: nodeVersion,
        acceleration: nodeAcceleration,
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

    // Calculate uptime dynamically based on createdAt timestamp
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
    const nodes = await this.prisma.node.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });

    // Calculate uptime dynamically based on createdAt timestamp
    const now = new Date();
    return nodes.map((node) => ({
      ...node,
      uptimeSeconds: Math.floor((now.getTime() - node.createdAt.getTime()) / 1000),
    }));
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
   * Find a node by API key (for authentication)
   *
   * @param apiKey API key to search for
   * @returns Node details or null if not found
   */
  async findByApiKey(apiKey: string): Promise<Node | null> {
    return this.prisma.node.findUnique({
      where: { apiKey },
    });
  }

  /**
   * Get the current node's information
   *
   * Determines which node this instance is by checking NODE_ID environment variable.
   * If NODE_ID is not set, returns the MAIN node (first registered node).
   * This is used by the frontend to determine UI restrictions based on node role.
   *
   * @returns Current node information
   * @throws NotFoundException if no nodes exist or NODE_ID is invalid
   */
  async getCurrentNode(): Promise<Node> {
    const nodeId = process.env.NODE_ID;

    // If NODE_ID is set, use it
    if (nodeId) {
      const node = await this.prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (!node) {
        throw new NotFoundException(`Node with ID ${nodeId} (from NODE_ID env) not found`);
      }

      return node;
    }

    // Fallback: Return the MAIN node (first registered node)
    const mainNode = await this.prisma.node.findFirst({
      where: { role: 'MAIN' },
      orderBy: { createdAt: 'asc' },
    });

    if (!mainNode) {
      throw new NotFoundException('No MAIN node found. Please register a node first.');
    }

    return mainNode;
  }

  /**
   * Update node configuration
   *
   * @param id Node identifier
   * @param data Update data
   * @returns Updated node
   * @throws NotFoundException if node doesn't exist
   */
  async update(id: string, data: UpdateNodeDto): Promise<Node> {
    const node = await this.prisma.node.findUnique({
      where: { id },
    });

    if (!node) {
      throw new NotFoundException(`Node with ID ${id} not found`);
    }

    return this.prisma.node.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.maxWorkers !== undefined && { maxWorkers: data.maxWorkers }),
        ...(data.cpuLimit !== undefined && { cpuLimit: data.cpuLimit }),
      },
    });
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
   * Generate a secure 6-digit pairing token
   *
   * SECURITY FIX: Uses crypto.randomBytes instead of Math.random()
   * - Cryptographically secure random number generation
   * - Prevents predictable token generation
   * - Uses rejection sampling to ensure uniform distribution
   *
   * Format: 000000-999999 (6 digits)
   *
   * @returns 6-digit pairing code
   */
  private generatePairingToken(): string {
    // SECURITY: Use crypto.randomBytes for cryptographically secure random numbers
    // Generate random number in range [100000, 999999] using rejection sampling
    let token: number;
    do {
      // Generate 4 random bytes (32 bits)
      const buffer = randomBytes(4);
      // Convert to unsigned 32-bit integer
      token = buffer.readUInt32BE(0);
      // Use modulo to get number in range [0, 999999], then add 100000 to get [100000, 999999]
      // Rejection sampling ensures uniform distribution
    } while (token > 4294967295 - (4294967295 % 900000)); // Reject values that would cause bias

    token = (token % 900000) + 100000;
    return token.toString();
  }
}
