import { Module } from '@nestjs/common';
import { LicensesController } from './licenses.controller';

@Module({
  controllers: [LicensesController],
  providers: [],
  exports: [],
})
export class LicensesModule {}
