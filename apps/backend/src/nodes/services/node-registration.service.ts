import { version as APP_VERSION } from '@bitbonsai/version';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type Node, NodeRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { LicenseRepository } from '../../common/repositories/license.repository';
import { NodeRepository } from '../../common/repositories/node.repository';
import type { NodeRegistrationResponseDto } from '../dto/node-registration-response.dto';
import type { RegisterNodeDto } from '../dto/register-node.dto';
import { StorageShareService } from './storage-share.service';

/**
 * NodeRegistrationService
 *
 * Handles node registration, pairing, and token generation.
 * Extracted from NodesService to separate registration concerns.
 */
@Injectable()
export class NodeRegistrationService {
  private readonly logger = new Logger(NodeRegistrationService.name);

  constructor(
    private readonly nodeRepository: NodeRepository,
    private readonly licenseRepository: LicenseRepository,
    private readonly storageShareService: StorageShareService
  ) {}

  /**
   * Register a new node with license validation
   */
  async registerNode(data: RegisterNodeDto): Promise<NodeRegistrationResponseDto> {
    let licenseKey = data.licenseKey;
    if (!licenseKey) {
      const mainNode = await this.nodeRepository.findFirstWithLicense({ role: NodeRole.MAIN });

      if (!mainNode) {
        throw new BadRequestException(
          'No main node found. License key is required for first node registration.'
        );
      }

      licenseKey = mainNode.license.key;
      this.logger.debug(`Using main node's license (${licenseKey}) for child node registration`);
    }

    const license = await this.licenseRepository.findByKeyWithInclude<{
      id: string;
      status: string;
      maxNodes: number;
      _count: { nodes: number };
    }>(licenseKey, { _count: { select: { nodes: true } } });

    if (!license || license.status !== 'ACTIVE') {
      throw new BadRequestException('Invalid or inactive license key');
    }

    if (license._count.nodes >= license.maxNodes) {
      throw new ConflictException(`Maximum nodes (${license.maxNodes}) reached for this license`);
    }

    const pairingToken = this.generatePairingToken();
    const pairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const role = license._count.nodes === 0 ? NodeRole.MAIN : NodeRole.LINKED;

    if (role === NodeRole.MAIN) {
      const existingMainNode = await this.nodeRepository.findFirstWithLicense({
        role: NodeRole.MAIN,
        licenseId: license.id,
      });

      if (existingMainNode) {
        this.logger.error(
          `❌ Attempted to create duplicate MAIN node! Existing MAIN: ${existingMainNode.name} (${existingMainNode.id})`
        );
        throw new ConflictException(
          'A MAIN node already exists for this license. Only one MAIN node is allowed per license.'
        );
      }
    }

    const nodeName =
      data.name || `${role === NodeRole.MAIN ? 'Main' : 'Linked'} Node ${license._count.nodes + 1}`;
    const nodeVersion = data.version || APP_VERSION;
    const nodeAcceleration = data.acceleration || 'CPU';

    const node = await this.nodeRepository.createNode({
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
   */
  async pairNode(pairingToken: string): Promise<Node> {
    const node = await this.nodeRepository.findFirst<Node | null>({
      where: {
        pairingToken,
        pairingExpiresAt: {
          gte: new Date(),
        },
      },
    });

    if (!node) {
      throw new NotFoundException('Invalid or expired pairing token');
    }

    const pairedNode = await this.nodeRepository.updateData(node.id, {
      pairingToken: null,
      pairingExpiresAt: null,
    });

    if (pairedNode.role === 'LINKED') {
      this.logger.log(
        `🗂️  Pairing complete - auto-mounting storage shares for ${pairedNode.name}...`
      );

      this.storageShareService
        .autoDetectAndMount(pairedNode.id)
        .then((result) => {
          this.logger.log(
            `✅ Storage auto-mount complete for ${pairedNode.name}: ${result.detected} detected, ${result.created} created, ${result.mounted} mounted`
          );
          if (result.errors.length > 0) {
            this.logger.warn(`⚠️  Mount errors: ${result.errors.join(', ')}`);
          }
        })
        .catch((error) => {
          this.logger.error(
            `❌ Failed to auto-mount storage shares for ${pairedNode.name}:`,
            error instanceof Error ? error.stack : error
          );
        });
    }

    return pairedNode;
  }

  /**
   * Generate a new pairing token for an existing node
   */
  async generatePairingTokenForNode(nodeId: string): Promise<NodeRegistrationResponseDto> {
    const node = await this.nodeRepository.findById(nodeId);

    if (!node) {
      throw new NotFoundException(`Node with ID ${nodeId} not found`);
    }

    const pairingToken = this.generatePairingToken();
    const pairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const updated = await this.nodeRepository.updateData(nodeId, {
      pairingToken,
      pairingExpiresAt,
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
   * Generate a secure API key for node authentication
   *
   * Format: bb_[64 hex characters]
   */
  generateApiKey(): string {
    const random = randomBytes(32).toString('hex');
    return `bb_${random}`;
  }

  /**
   * Generate a secure 6-digit pairing token
   *
   * SECURITY FIX: Uses crypto.randomBytes instead of Math.random()
   */
  generatePairingToken(): string {
    let token: number;
    do {
      const buffer = randomBytes(4);
      token = buffer.readUInt32BE(0);
    } while (token > 4294967295 - (4294967295 % 900000));

    token = (token % 900000) + 100000;
    return token.toString();
  }
}
