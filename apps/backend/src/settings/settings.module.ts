import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { SettingsController } from './settings.controller';

@Module({
  imports: [CommonModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
