import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LicenseTier } from '@prisma/client';
import type { ActivateLicenseDto } from './dto/activate-license.dto';
import { LicenseDto } from './dto/license.dto';

@ApiTags('licenses')
@Controller('licenses')
export class LicensesController {
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
    // TODO: Implement actual license retrieval from database
    // For now, return FREE tier with default values
    return {
      tier: LicenseTier.FREE,
      licenseKey: 'XXX-XXXX-XXXX-FREE',
      email: 'user@example.com',
      validUntil: 'Lifetime',
      maxNodes: 1,
      usedNodes: 0,
      maxConcurrentJobs: 2,
      features: [
        { name: 'Single Node', enabled: true },
        { name: 'SQLite Database', enabled: true },
        { name: 'Basic Analytics', enabled: true },
        { name: 'Community Support', enabled: true },
        { name: 'API Access', enabled: false },
        { name: 'PostgreSQL Support', enabled: false },
        { name: 'Priority Support', enabled: false },
        { name: 'Advanced Workflows', enabled: false },
      ],
    };
  }

  @Post('activate')
  @ApiOperation({
    summary: 'Activate a license key',
    description:
      'Validate and activate a new license key. Upgrades the current license tier and updates feature access. Returns the activated license information.',
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
    // TODO: Implement actual license activation logic
    // For now, simulate PATREON tier activation
    const maskedKey = `${activateDto.licenseKey.slice(0, 3)}-XXXX-XXXX-${activateDto.licenseKey.slice(-4)}`;

    return {
      tier: LicenseTier.PATREON,
      licenseKey: maskedKey,
      email: activateDto.email,
      validUntil: '2026-12-31T23:59:59Z',
      maxNodes: 2,
      usedNodes: 0,
      maxConcurrentJobs: 5,
      features: [
        { name: 'Multi-Node (2 nodes)', enabled: true },
        { name: 'SQLite Database', enabled: true },
        { name: 'API Access', enabled: true },
        { name: 'Advanced Analytics', enabled: true },
        { name: 'Email Support', enabled: true },
        { name: 'PostgreSQL Support', enabled: false },
        { name: 'Priority Support', enabled: false },
        { name: 'Advanced Workflows', enabled: true },
      ],
    };
  }
}
