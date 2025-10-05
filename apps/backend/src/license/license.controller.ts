import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CreateLicenseDto } from './dto/create-license.dto';
import type { ValidateLicenseDto } from './dto/validate-license.dto';
import type { LicenseService } from './license.service';

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
  constructor(private readonly licenseService: LicenseService) {}

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
  @ApiResponse({
    status: 201,
    description: 'License created successfully',
    schema: {
      example: {
        id: 'clx1a2b3c4d5e6f7g8h9i0',
        key: 'FRE-x8k2p9m4n7',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'user@example.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {
          multiNode: false,
          advancedPresets: false,
          api: false,
          priorityQueue: false,
          cloudStorage: false,
          webhooks: false,
        },
        validUntil: null,
        createdAt: '2025-10-01T15:30:00.000Z',
        updatedAt: '2025-10-01T15:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data',
  })
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
  @ApiResponse({
    status: 200,
    description: 'License is valid',
    schema: {
      example: {
        id: 'clx1a2b3c4d5e6f7g8h9i0',
        key: 'FRE-x8k2p9m4n7',
        tier: 'FREE',
        status: 'ACTIVE',
        validUntil: null,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {
          multiNode: false,
          advancedPresets: false,
          api: false,
          priorityQueue: false,
          cloudStorage: false,
          webhooks: false,
        },
        email: 'user@example.com',
        createdAt: '2025-10-01T15:30:00.000Z',
        updatedAt: '2025-10-01T15:30:00.000Z',
        canAddNode: true,
        activeNodes: 0,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'License is not active or has expired',
  })
  @ApiResponse({
    status: 404,
    description: 'License not found',
  })
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
  @ApiResponse({
    status: 200,
    description: 'Returns boolean indicating if a node can be added',
    schema: {
      example: {
        canAddNode: true,
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'License not found',
  })
  async canAddNode(@Param('id') id: string) {
    const canAdd = await this.licenseService.checkCanAddNode(id);
    return { canAddNode: canAdd };
  }
}
