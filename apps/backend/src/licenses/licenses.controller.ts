import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LicenseTier } from '@prisma/client';
import { LicenseGuardService } from '../license/license-guard.service';
import type { ActivateLicenseDto } from './dto/activate-license.dto';
import { LicenseDto } from './dto/license.dto';

/**
 * License Tier Configuration
 *
 * FREE:              1 node,  2 concurrent - Basic features
 * PATREON_SUPPORTER: 2 nodes, 3 concurrent - $3/mo - Multi-node, advanced presets
 * PATREON_PLUS:      3 nodes, 5 concurrent - $5/mo - Same as Supporter
 * PATREON_PRO:       5 nodes, 10 concurrent - $10/mo - + API, webhooks, priority queue
 * PATREON_ULTIMATE:  10 nodes, 20 concurrent - $20/mo - All Patreon features
 * COMMERCIAL_*:      15-999 nodes - Business licenses with cloud storage
 */
@ApiTags('licenses')
@Controller('licenses')
export class LicensesController {
  constructor(private readonly licenseGuard: LicenseGuardService) {}

  @Get('current')
  @ApiOperation({
    summary: 'Get current license information',
    description:
      'Retrieve current license tier, limits, features, and validity period. Used by settings UI to display license status and upgrade options.',
  })
  @ApiResponse({
    status: 200,
    description: 'License information retrieved successfully',
    type: LicenseDto,
  })
  async getCurrentLicense(): Promise<LicenseDto> {
    const capabilities = await this.licenseGuard.getCapabilities();

    return {
      tier: capabilities.tier,
      licenseKey: capabilities.tier === LicenseTier.FREE ? 'FREE-TIER' : 'ACTIVATED',
      email: null,
      validUntil: 'Lifetime',
      maxNodes: capabilities.maxNodes,
      usedNodes: capabilities.currentNodes,
      maxConcurrentJobs: capabilities.maxConcurrentJobs,
      features: [
        { name: 'Single Node', enabled: true },
        { name: 'Multi-Node', enabled: capabilities.features.multiNode },
        { name: 'Advanced Presets', enabled: capabilities.features.advancedPresets },
        { name: 'API Access', enabled: capabilities.features.api },
        { name: 'Priority Queue', enabled: capabilities.features.priorityQueue },
        { name: 'Webhooks', enabled: capabilities.features.webhooks },
        { name: 'Cloud Storage', enabled: capabilities.features.cloudStorage },
      ],
    };
  }

  @Get('capabilities')
  @ApiOperation({
    summary: 'Get license capabilities and usage',
    description: 'Returns current license limits, usage, and whether upgrades are recommended.',
  })
  async getCapabilities() {
    const capabilities = await this.licenseGuard.getCapabilities();
    const upgradeRecommendation = await this.licenseGuard.getUpgradeRecommendation();

    return {
      ...capabilities,
      ...upgradeRecommendation,
    };
  }

  @Get('tiers')
  @ApiOperation({
    summary: 'Get available license tiers',
    description: 'Returns all available license tiers with their limits and features.',
  })
  async getAvailableTiers() {
    return {
      tiers: [
        {
          id: LicenseTier.FREE,
          name: 'Free',
          price: 0,
          maxNodes: 1,
          maxConcurrentJobs: 2,
          features: ['Single node', 'Basic presets', 'Community support'],
        },
        {
          id: LicenseTier.PATREON_SUPPORTER,
          name: 'Supporter',
          price: 3,
          priceUnit: 'month',
          maxNodes: 2,
          maxConcurrentJobs: 3,
          features: ['Multi-node (2)', 'Advanced presets', 'Email support'],
        },
        {
          id: LicenseTier.PATREON_PLUS,
          name: 'Plus',
          price: 5,
          priceUnit: 'month',
          maxNodes: 3,
          maxConcurrentJobs: 5,
          features: ['Multi-node (3)', 'Advanced presets', 'Email support'],
        },
        {
          id: LicenseTier.PATREON_PRO,
          name: 'Pro',
          price: 10,
          priceUnit: 'month',
          maxNodes: 5,
          maxConcurrentJobs: 10,
          features: ['Multi-node (5)', 'API access', 'Webhooks', 'Priority queue'],
          recommended: true,
        },
        {
          id: LicenseTier.PATREON_ULTIMATE,
          name: 'Ultimate',
          price: 20,
          priceUnit: 'month',
          maxNodes: 10,
          maxConcurrentJobs: 20,
          features: ['Multi-node (10)', 'All Pro features', 'Priority support'],
        },
        {
          id: LicenseTier.COMMERCIAL_STARTER,
          name: 'Business Starter',
          price: 49,
          priceUnit: 'month',
          maxNodes: 15,
          maxConcurrentJobs: 30,
          features: ['Multi-node (15)', 'Cloud storage', 'SLA support'],
        },
        {
          id: LicenseTier.COMMERCIAL_PRO,
          name: 'Business Pro',
          price: 149,
          priceUnit: 'month',
          maxNodes: 50,
          maxConcurrentJobs: 100,
          features: ['Multi-node (50)', 'Cloud storage', 'Dedicated support'],
        },
        {
          id: LicenseTier.COMMERCIAL_ENTERPRISE,
          name: 'Enterprise',
          price: null,
          priceUnit: 'contact',
          maxNodes: 999,
          maxConcurrentJobs: 999,
          features: ['Unlimited nodes', 'Custom integrations', 'On-premise support'],
        },
      ],
    };
  }

  @Post('activate')
  @ApiOperation({
    summary: 'Activate a license key',
    description:
      'Validate and activate a new license key. Upgrades the current license tier and updates feature access.',
  })
  @ApiResponse({
    status: 200,
    description: 'License activated successfully',
    type: LicenseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid license key format or activation failed',
  })
  async activateLicense(@Body() activateDto: ActivateLicenseDto): Promise<LicenseDto> {
    // TODO: Wire to actual license validation
    const maskedKey = `${activateDto.licenseKey.slice(0, 3)}-XXXX-XXXX-${activateDto.licenseKey.slice(-4)}`;

    return {
      tier: LicenseTier.PATREON_PRO,
      licenseKey: maskedKey,
      email: activateDto.email,
      validUntil: '2026-12-31T23:59:59Z',
      maxNodes: 5,
      usedNodes: 0,
      maxConcurrentJobs: 10,
      features: [
        { name: 'Multi-Node (5)', enabled: true },
        { name: 'Advanced Presets', enabled: true },
        { name: 'API Access', enabled: true },
        { name: 'Webhooks', enabled: true },
        { name: 'Priority Queue', enabled: true },
        { name: 'Cloud Storage', enabled: false },
      ],
    };
  }
}
