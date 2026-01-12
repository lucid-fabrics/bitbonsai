import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { AdminApiKeyGuard } from '../security/admin-api-key.guard';
import { CreatePromoCodeDto, PromoService, UpdatePromoCodeDto } from './promo.service';

@ApiTags('Admin - Promo Codes')
@Controller('admin/promo-codes')
@UseGuards(AdminApiKeyGuard)
@ApiBearerAuth()
export class PromoAdminController {
  constructor(private readonly promoService: PromoService) {}

  @Get()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async getAllPromoCodes() {
    return this.promoService.getAllPromoCodes();
  }

  @Get(':id')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async getPromoCodeById(@Param('id') id: string) {
    return this.promoService.getPromoCodeById(id);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createPromoCode(
    @Body() dto: CreatePromoCodeDto,
    @Headers('x-admin-api-key') apiKey: string
  ) {
    const adminUserId = this.getAdminId(apiKey);
    return this.promoService.createPromoCode(dto, adminUserId);
  }

  @Patch(':id')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async updatePromoCode(
    @Param('id') id: string,
    @Body() dto: UpdatePromoCodeDto,
    @Headers('x-admin-api-key') apiKey: string
  ) {
    const adminUserId = this.getAdminId(apiKey);
    return this.promoService.updatePromoCode(id, dto, adminUserId);
  }

  @Post(':id/deactivate')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async deactivatePromoCode(@Param('id') id: string, @Headers('x-admin-api-key') apiKey: string) {
    const adminUserId = this.getAdminId(apiKey);
    await this.promoService.deactivatePromoCode(id, adminUserId);
    return { success: true };
  }

  private getAdminId(apiKey: string): string {
    return `admin-${Buffer.from(apiKey).toString('base64').slice(0, 12)}`;
  }
}

@ApiTags('Promo Codes')
@Controller('promo-codes')
export class PromoPublicController {
  constructor(private readonly promoService: PromoService) {}

  @Public()
  @Post('validate')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async validatePromoCode(@Body() body: { code: string }) {
    return this.promoService.validatePromoCode(body.code);
  }
}
