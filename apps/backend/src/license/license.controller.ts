import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ActivateLicenseDto } from './dto/activate-license.dto';
import type { CreateLicenseDto } from './dto/create-license.dto';
import { LookupLicenseDto } from './dto/lookup-license.dto';
import { SetLicenseKeyDto } from './dto/set-license-key.dto';
import type { ValidateLicenseDto } from './dto/validate-license.dto';
import { LicenseService } from './license.service';
import { LicenseClientService, type LookupLicenseResponse } from './license-client.service';

/**
 * LicenseController
 *
 * REST API endpoints for license management:
 * - POST /api/v1/licenses - Create a new license
 * - POST /api/v1/licenses/validate - Validate a license key
 * - GET /api/v1/licenses/:id/can-add-node - Check if a node can be added
 */
@ApiTags('licenses')
@Controller('licenses')
export class LicenseController {
  constructor(
    private readonly licenseService: LicenseService,
    private readonly licenseClient: LicenseClientService
  ) {}

  /**
   * Create a new license
   *
   * Generates a new license with tier-specific configuration.
   * The license key is automatically generated based on the tier.
   */
  @Post()
  @ApiOperation({
    summary: 'Create a new license',
    description:
      'Generates a new license with tier-specific configuration (FREE, PATREON, or COMMERCIAL)',
  })
  @ApiCreatedResponse({ description: 'License created successfully' })
  @ApiBadRequestResponse({ description: 'Invalid input data' })
  async create(@Body() createLicenseDto: CreateLicenseDto) {
    return this.licenseService.createLicense(createLicenseDto);
  }

  /**
   * Validate a license key
   *
   * Checks if the license is valid, active, and not expired.
   * Returns license details including node capacity information.
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate a license key',
    description:
      'Checks if the license is valid, active, and not expired. Returns license details with node capacity.',
  })
  @ApiOkResponse({ description: 'License is valid' })
  @ApiBadRequestResponse({ description: 'License inactive or expired' })
  @ApiNotFoundResponse({ description: 'License not found' })
  async validate(@Body() validateLicenseDto: ValidateLicenseDto) {
    return this.licenseService.validateLicense(validateLicenseDto.key);
  }

  /**
   * Check if a node can be added to this license
   *
   * Verifies that the license has not reached its maximum node limit.
   */
  @Get(':id/can-add-node')
  @ApiOperation({
    summary: 'Check if a node can be added',
    description: 'Verifies that the license has not reached its maximum node limit',
  })
  @ApiParam({
    name: 'id',
    description: 'License ID',
    example: 'clx1a2b3c4d5e6f7g8h9i0',
  })
  @ApiOkResponse({ description: 'Node limit check result' })
  @ApiNotFoundResponse({ description: 'License not found' })
  async canAddNode(@Param('id') id: string) {
    const canAdd = await this.licenseService.checkCanAddNode(id);
    return { canAddNode: canAdd };
  }

  /**
   * Get current license information (consumer mode)
   *
   * Returns the license verification status and limits for this BitBonsai instance
   * Rate limited to 10 requests per minute to prevent abuse
   */
  @Get('current')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get current license information',
    description: 'Returns license verification status and limits for this BitBonsai instance',
  })
  @ApiOkResponse({ description: 'Current license info' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async getCurrentLicense() {
    return this.licenseClient.verifyLicense();
  }

  /**
   * Get current license limits (consumer mode)
   *
   * Returns node and job limits based on license tier
   * Rate limited to 10 requests per minute to prevent abuse
   */
  @Get('limits')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get current license limits',
    description: 'Returns node and job limits based on license tier',
  })
  @ApiOkResponse({ description: 'Current license limits' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async getCurrentLimits() {
    return this.licenseClient.getCurrentLimits();
  }

  /**
   * Set license key (consumer mode)
   *
   * Updates the license key and immediately verifies it
   * Rate limited to 5 requests per minute to prevent brute force
   */
  @Put('key')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Set license key',
    description: 'Updates the license key and immediately verifies it',
  })
  @ApiOkResponse({ description: 'License key updated' })
  @ApiBadRequestResponse({ description: 'Invalid license key' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async setLicenseKey(@Body() dto: SetLicenseKeyDto) {
    await this.licenseClient.setLicenseKey(dto.key);
    return { success: true, message: 'License key updated and verified' };
  }

  /**
   * Activate a license (consumer mode)
   *
   * Verifies the license key with the licensing-service and stores it locally
   * Rate limited to 5 requests per minute to prevent brute force
   */
  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Activate a license key',
    description:
      'Verifies the license key with the central licensing service and stores it locally',
  })
  @ApiOkResponse({ description: 'License activated' })
  @ApiBadRequestResponse({ description: 'Invalid license key' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async activateLicense(@Body() dto: ActivateLicenseDto) {
    return this.licenseClient.activateLicense(dto.key, dto.email);
  }

  /**
   * Lookup a license by email (consumer mode)
   *
   * For post-checkout flows - allows users to retrieve their license after purchase
   * Rate limited to 10 requests per minute to prevent enumeration
   */
  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Lookup license by email',
    description:
      'Find an active license associated with an email address (for post-checkout flows)',
  })
  @ApiOkResponse({ description: 'License lookup result' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async lookupLicense(@Body() dto: LookupLicenseDto): Promise<LookupLicenseResponse> {
    return this.licenseClient.lookupLicenseByEmail(dto.email);
  }
}
