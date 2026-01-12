import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CryptoService } from '../crypto/crypto.service';
import { AdminApiKeyGuard } from '../guards/admin-api-key.guard';
import {
  CreateLicenseDto,
  LicenseResponseDto,
  RevokeLicenseDto,
  VerifyLicenseDto,
  VerifyLicenseResponseDto,
} from './_dtos';
import { LicenseService } from './_services/license.service';

@ApiTags('licenses')
@Controller('licenses')
export class LicenseController {
  constructor(
    private readonly licenseService: LicenseService,
    private readonly cryptoService: CryptoService
  ) {}

  @Post()
  @UseGuards(AdminApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Create a new license (admin only)' })
  @ApiResponse({
    status: 201,
    description: 'License created successfully',
    type: LicenseResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid request body' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
  async create(@Body() dto: CreateLicenseDto): Promise<LicenseResponseDto> {
    const license = await this.licenseService.create(dto);
    return this.mapToResponse(license);
  }

  @Public()
  @Post('verify')
  @ApiOperation({ summary: 'Verify a license key' })
  @ApiResponse({ status: 200, description: 'Verification result', type: VerifyLicenseResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid request body' })
  async verify(@Body() dto: VerifyLicenseDto): Promise<VerifyLicenseResponseDto> {
    return this.licenseService.verify(dto);
  }

  @Get()
  @UseGuards(AdminApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'List all licenses with pagination (admin only)' })
  @ApiQuery({
    name: 'skip',
    required: false,
    type: Number,
    description: 'Number of records to skip',
  })
  @ApiQuery({
    name: 'take',
    required: false,
    type: Number,
    description: 'Number of records to take (max 100)',
  })
  @ApiResponse({ status: 200, description: 'List of licenses', type: [LicenseResponseDto] })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
  async findAll(
    @Query() query: { skip?: number; take?: number }
  ): Promise<{ data: LicenseResponseDto[]; total: number }> {
    const skip = query.skip || 0;
    const take = query.take || 20;

    const [licenses, total] = await Promise.all([
      this.licenseService.findAll({ skip, take }),
      this.licenseService.count(),
    ]);
    return {
      data: licenses.map((l) => this.mapToResponse(l)),
      total,
    };
  }

  @Public()
  @Get('public-key')
  @ApiOperation({ summary: 'Get the public key for offline license verification' })
  @ApiResponse({ status: 200, description: 'Public key in PEM format' })
  getPublicKey(): { publicKey: string } {
    return { publicKey: this.cryptoService.getPublicKeyPem() };
  }

  @Get(':id')
  @UseGuards(AdminApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Get a license by ID (admin only)' })
  @ApiParam({ name: 'id', description: 'License ID' })
  @ApiResponse({ status: 200, description: 'License details', type: LicenseResponseDto })
  @ApiNotFoundResponse({ description: 'License not found' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
  async findById(@Param('id') id: string): Promise<LicenseResponseDto> {
    const license = await this.licenseService.findById(id);
    return this.mapToResponse(license);
  }

  @Get('email/:email')
  @UseGuards(AdminApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Find licenses by email (admin only)' })
  @ApiParam({ name: 'email', description: 'Email address to search' })
  @ApiResponse({
    status: 200,
    description: 'List of licenses for email',
    type: [LicenseResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
  async findByEmail(@Param('email') email: string): Promise<LicenseResponseDto[]> {
    const licenses = await this.licenseService.findByEmail(email);
    return licenses.map((l) => this.mapToResponse(l));
  }

  @Post(':id/revoke')
  @UseGuards(AdminApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Revoke a license (admin only)' })
  @ApiParam({ name: 'id', description: 'License ID to revoke' })
  @ApiResponse({
    status: 200,
    description: 'License revoked successfully',
    type: LicenseResponseDto,
  })
  @ApiNotFoundResponse({ description: 'License not found' })
  @ApiBadRequestResponse({ description: 'Invalid request body' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
  async revoke(
    @Param('id') id: string,
    @Body() dto: RevokeLicenseDto
  ): Promise<LicenseResponseDto> {
    const license = await this.licenseService.revoke(id, dto.reason);
    return this.mapToResponse(license);
  }

  private mapToResponse(license: {
    id: string;
    key: string;
    email: string;
    tier: string;
    maxNodes: number;
    maxConcurrentJobs: number;
    expiresAt: Date | null;
    createdAt: Date;
  }): LicenseResponseDto {
    return {
      id: license.id,
      key: license.key,
      email: license.email,
      tier: license.tier as LicenseResponseDto['tier'],
      maxNodes: license.maxNodes,
      maxConcurrentJobs: license.maxConcurrentJobs,
      expiresAt: license.expiresAt ?? undefined,
      createdAt: license.createdAt,
    };
  }
}
