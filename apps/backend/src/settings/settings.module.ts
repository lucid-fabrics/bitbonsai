import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [CommonModule, IntegrationsModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
