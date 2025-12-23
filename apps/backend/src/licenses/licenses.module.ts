import { Module } from '@nestjs/common';
import { LicenseModule } from '../license/license.module';
import { LicensesController } from './licenses.controller';

@Module({
  imports: [LicenseModule],
  controllers: [LicensesController],
})
export class LicensesModule {}
