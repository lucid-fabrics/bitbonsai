import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { PromoAdminController, PromoPublicController } from './promo.controller';
import { PromoService } from './promo.service';

@Module({
  imports: [PrismaModule, SecurityModule],
  controllers: [PromoAdminController, PromoPublicController],
  providers: [PromoService],
  exports: [PromoService],
})
export class PromoModule {}
