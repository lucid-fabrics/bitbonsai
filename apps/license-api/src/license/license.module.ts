import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { LicenseRepository } from './_repositories/license.repository';
import { LicenseService } from './_services/license.service';
import { LicenseController } from './license.controller';

@Module({
  imports: [CryptoModule],
  controllers: [LicenseController],
  providers: [LicenseService, LicenseRepository],
  exports: [LicenseService],
})
export class LicenseModule {}
