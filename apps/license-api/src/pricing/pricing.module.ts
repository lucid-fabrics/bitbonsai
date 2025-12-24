import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { PricingAdminController, PricingPublicController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  imports: [PrismaModule, SecurityModule],
  controllers: [PricingAdminController, PricingPublicController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
