import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { AppConfigController } from './app-config.controller';
import { AppConfigService } from './app-config.service';
import { ConfigCryptoService } from './config-crypto.service';

@Module({
  imports: [PrismaModule, SecurityModule],
  controllers: [AppConfigController],
  providers: [AppConfigService, ConfigCryptoService],
  exports: [AppConfigService, ConfigCryptoService],
})
export class AppConfigModule {}
