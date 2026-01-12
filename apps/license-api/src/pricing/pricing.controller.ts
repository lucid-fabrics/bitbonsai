import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { AdminApiKeyGuard } from '../security/admin-api-key.guard';
import { CreatePricingTierDto, PricingService, UpdatePricingTierDto } from './pricing.service';

@ApiTags('Admin - Pricing')
@Controller('admin/pricing')
@UseGuards(AdminApiKeyGuard)
@ApiBearerAuth()
export class PricingAdminController {
  constructor(private readonly pricingService: PricingService) {}

  @Get()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async getAllTiers() {
    return this.pricingService.getAllTiers();
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createTier(@Body() dto: CreatePricingTierDto, @Headers('x-admin-api-key') apiKey: string) {
    const adminUserId = this.getAdminId(apiKey);
    return this.pricingService.createTier(dto, adminUserId);
  }

  @Patch(':id')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async updateTier(
    @Param('id') id: string,
    @Body() dto: UpdatePricingTierDto,
    @Headers('x-admin-api-key') apiKey: string
  ) {
    const adminUserId = this.getAdminId(apiKey);
    return this.pricingService.updateTier(id, dto, adminUserId);
  }

  @Post(':id/publish')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async publishTier(@Param('id') id: string, @Headers('x-admin-api-key') apiKey: string) {
    const adminUserId = this.getAdminId(apiKey);
    await this.pricingService.publishTier(id, adminUserId);
    return { success: true };
  }

  @Post(':id/deactivate')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async deactivateTier(@Param('id') id: string, @Headers('x-admin-api-key') apiKey: string) {
    const adminUserId = this.getAdminId(apiKey);
    await this.pricingService.deactivateTier(id, adminUserId);
    return { success: true };
  }

  @Post(':id/map-patreon')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async mapPatreonTier(
    @Param('id') id: string,
    @Body() body: { patreonTierId: string },
    @Headers('x-admin-api-key') apiKey: string
  ) {
    const adminUserId = this.getAdminId(apiKey);
    await this.pricingService.mapPatreonTier(id, body.patreonTierId, adminUserId);
    return { success: true };
  }

  private getAdminId(apiKey: string): string {
    return `admin-${Buffer.from(apiKey).toString('base64').slice(0, 12)}`;
  }
}

@ApiTags('Pricing')
@Controller('pricing')
export class PricingPublicController {
  constructor(private readonly pricingService: PricingService) {}

  @Public()
  @Get()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async getActiveTiers() {
    return this.pricingService.getActiveTiers();
  }

  @Public()
  @Get(':id')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async getTierById(@Param('id') id: string) {
    return this.pricingService.getTierById(id);
  }
}
