import { Global, Module } from '@nestjs/common';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  // SettingsRepository is global because JwtAuthGuard (used via @UseGuards in
  // several modules and as APP_GUARD) injects it; guards resolve dependencies
  // in each consuming module's context, so it must be available everywhere.
  providers: [PrismaService, SettingsRepository],
  exports: [PrismaService, SettingsRepository],
})
export class PrismaModule {}
