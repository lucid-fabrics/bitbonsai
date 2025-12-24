import type { LicenseFeatures } from '@bitbonsai/prisma-types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LicenseStatus, LicenseTier, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLicenseDto } from './dto/create-license.dto';

/**
 * LicenseService
 *
 * Handles all license-related business logic:
 * - License validation and verification
 * - License creation with tier-based configuration
 * - Node limit checking
 */
@Injectable()
export class LicenseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate a license key
   *
   * Checks:
   * - License exists
   * - License is active
   * - License has not expired
   * - Returns license details with node capacity information
   *
   * @param key - The license key to validate
   * @returns License details with node capacity
   * @throws NotFoundException if license not found
   * @throws BadRequestException if license is not active or has expired
   */
  async validateLicense(key: string) {
    const license = await this.prisma.license.findUnique({
      where: { key },
      select: {
        id: true,
        tier: true,
        status: true,
        validUntil: true,
        maxNodes: true,
        maxConcurrentJobs: true,
        features: true,
        email: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            nodes: { where: { status: 'ONLINE' } },
          },
        },
      },
    });

    if (!license) {
      throw new NotFoundException('License not found');
    }

    if (license.status !== LicenseStatus.ACTIVE) {
      throw new BadRequestException('License is not active');
    }

    if (license.validUntil && license.validUntil < new Date()) {
      throw new BadRequestException('License has expired');
    }

    const features = license.features as unknown as LicenseFeatures;

    return {
      id: license.id,
      key,
      tier: license.tier,
      status: license.status,
      validUntil: license.validUntil,
      maxNodes: license.maxNodes,
      maxConcurrentJobs: license.maxConcurrentJobs,
      features,
      email: license.email,
      createdAt: license.createdAt,
      updatedAt: license.updatedAt,
      canAddNode: license._count.nodes < license.maxNodes,
      activeNodes: license._count.nodes,
    };
  }

  /**
   * Create a new license
   *
   * Generates a license key and configures it based on the tier:
   * - FREE: 1 node, 2 concurrent jobs, limited features
   * - PATREON: 2 nodes, 5 concurrent jobs, advanced features
   * - COMMERCIAL: 20+ nodes, 50+ concurrent jobs, all features
   *
   * @param data - License creation data
   * @returns The created license
   */
  async createLicense(data: CreateLicenseDto) {
    const tierConfig = {
      // Free tier - single node, limited concurrency
      [LicenseTier.FREE]: { maxNodes: 1, maxConcurrentJobs: 2 },
      // Patreon tiers - individual supporters
      [LicenseTier.PATREON]: { maxNodes: 2, maxConcurrentJobs: 3 }, // Legacy
      [LicenseTier.PATREON_SUPPORTER]: { maxNodes: 2, maxConcurrentJobs: 3 }, // $3/mo
      [LicenseTier.PATREON_PLUS]: { maxNodes: 3, maxConcurrentJobs: 5 }, // $5/mo
      [LicenseTier.PATREON_PRO]: { maxNodes: 5, maxConcurrentJobs: 10 }, // $10/mo
      [LicenseTier.PATREON_ULTIMATE]: { maxNodes: 10, maxConcurrentJobs: 20 }, // $20/mo
      // Commercial tiers - businesses
      [LicenseTier.COMMERCIAL_STARTER]: { maxNodes: 15, maxConcurrentJobs: 30 },
      [LicenseTier.COMMERCIAL_PRO]: { maxNodes: 50, maxConcurrentJobs: 100 },
      [LicenseTier.COMMERCIAL_ENTERPRISE]: { maxNodes: 999, maxConcurrentJobs: 999 },
    };

    const config = tierConfig[data.tier];

    const _isPatreon = data.tier.startsWith('PATREON');
    const isCommercial = data.tier.startsWith('COMMERCIAL');
    const isPatreonProOrHigher =
      data.tier === LicenseTier.PATREON_PRO || data.tier === LicenseTier.PATREON_ULTIMATE;

    const features: LicenseFeatures = {
      multiNode: data.tier !== LicenseTier.FREE,
      advancedPresets: data.tier !== LicenseTier.FREE,
      api: isPatreonProOrHigher || isCommercial,
      priorityQueue: isPatreonProOrHigher || isCommercial,
      cloudStorage: isCommercial,
      webhooks: isPatreonProOrHigher || isCommercial,
    };

    return this.prisma.license.create({
      data: {
        key: this.generateLicenseKey(data.tier),
        tier: data.tier,
        status: LicenseStatus.ACTIVE,
        email: data.email,
        maxNodes: config.maxNodes,
        maxConcurrentJobs: config.maxConcurrentJobs,
        features: features as unknown as Prisma.InputJsonValue,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
      },
    });
  }

  /**
   * Check if a license can add a new node
   *
   * Verifies that the license has not reached its maximum node limit
   *
   * @param licenseId - The license ID to check
   * @returns Boolean indicating if a node can be added
   * @throws NotFoundException if license not found
   */
  async checkCanAddNode(licenseId: string): Promise<boolean> {
    const license = await this.prisma.license.findUnique({
      where: { id: licenseId },
      select: {
        maxNodes: true,
        _count: {
          select: {
            nodes: true,
          },
        },
      },
    });

    if (!license) {
      throw new NotFoundException('License not found');
    }

    return license._count.nodes < license.maxNodes;
  }

  /**
   * Generate a unique license key
   *
   * Format: [TIER_PREFIX]-[RANDOM_STRING]
   * Example: FRE-x8k2p9m4n7
   *
   * @param tier - The license tier
   * @returns A unique license key
   */
  private generateLicenseKey(tier: LicenseTier): string {
    const prefix = tier.substring(0, 3).toUpperCase();
    const random = Math.random().toString(36).substring(2, 12);
    return `${prefix}-${random}`;
  }
}
