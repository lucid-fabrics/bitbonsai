import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [CommonModule, IntegrationsModule, PrismaModule],
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository],
  exports: [SettingsService],
})
export class SettingsModule {}
