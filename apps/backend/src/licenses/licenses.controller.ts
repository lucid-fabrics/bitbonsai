import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LicenseTier } from '@prisma/client';
import { LicenseGuardService } from '../license/license-guard.service';
import { ActivateLicenseDto } from './dto/activate-license.dto';
import { LicenseDto } from './dto/license.dto';
import { LookupLicenseDto } from './dto/lookup-license.dto';
import { LicensesService } from './licenses.service';

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
  constructor(
    private readonly licenseGuard: LicenseGuardService,
    private readonly licensesService: LicensesService
  ) {}

  @Get('current')
  @ApiOperation({
    summary: 'Get current license information',
    description:
      'Retrieve current license tier, limits, features, and validity period. Used by settings UI to display license status and upgrade options.',
  })
  @ApiOkResponse({ description: 'License info retrieved', type: LicenseDto })
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
  @ApiOkResponse({ description: 'Capabilities and usage retrieved' })
  async getCapabilities(): Promise<unknown> {
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
  @ApiOkResponse({ description: 'Available tiers retrieved' })
  async getAvailableTiers(): Promise<unknown> {
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
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 requests per minute - matches licensing-service
  @ApiOperation({
    summary: 'Activate a license key',
    description:
      'Validate and activate a new license key. Upgrades the current license tier and updates feature access.',
  })
  @ApiOkResponse({ description: 'License activated', type: LicenseDto })
  @ApiBadRequestResponse({ description: 'Invalid license key' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async activateLicense(@Body() activateDto: ActivateLicenseDto): Promise<LicenseDto> {
    const result = await this.licensesService.activateLicense(activateDto);

    // Get capabilities to get current node count
    const capabilities = await this.licenseGuard.getCapabilities();

    // Mask the license key for display (security: minimize exposed chars)
    const maskedKey = this.maskLicenseKey(activateDto.licenseKey);

    // Determine features based on tier
    const isPatreonProOrHigher =
      result.tier === LicenseTier.PATREON_PRO || result.tier === LicenseTier.PATREON_ULTIMATE;
    const isCommercial = result.tier.startsWith('COMMERCIAL');

    return {
      tier: result.tier,
      licenseKey: maskedKey,
      email: result.email,
      validUntil: result.expiresAt ? result.expiresAt.toISOString() : 'Lifetime',
      maxNodes: result.maxNodes,
      usedNodes: capabilities.currentNodes,
      maxConcurrentJobs: result.maxConcurrentJobs,
      features: [
        { name: 'Single Node', enabled: true },
        { name: 'Multi-Node', enabled: result.tier !== LicenseTier.FREE },
        { name: 'Advanced Presets', enabled: result.tier !== LicenseTier.FREE },
        { name: 'API Access', enabled: isPatreonProOrHigher || isCommercial },
        { name: 'Priority Queue', enabled: isPatreonProOrHigher || isCommercial },
        { name: 'Webhooks', enabled: isPatreonProOrHigher || isCommercial },
        { name: 'Cloud Storage', enabled: isCommercial },
      ],
    };
  }

  @Post('lookup')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 requests per minute - matches licensing-service
  @ApiOperation({
    summary: 'Lookup license by email',
    description: 'Find license associated with an email address (for post-Stripe checkout flow).',
  })
  @ApiOkResponse({ description: 'License lookup result' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async lookupLicense(@Body() dto: LookupLicenseDto): Promise<{
    found: boolean;
    license?: {
      tier: string;
      maxNodes: number;
      maxConcurrentJobs: number;
      maskedKey: string;
    };
  }> {
    return this.licensesService.lookupLicenseByEmail(dto.email);
  }

  /**
   * Mask license key for display (security: minimize exposed chars)
   */
  private maskLicenseKey(key: string): string {
    if (key.length <= 20) return '****';
    const prefixMatch = key.match(/^(BITBONSAI-[A-Z]+-)/);
    const prefix = prefixMatch ? prefixMatch[1] : `${key.slice(0, 12)}-`;
    return `${prefix}****${key.slice(-4)}`;
  }
}
