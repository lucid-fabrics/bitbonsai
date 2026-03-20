import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { LicenseRepository } from '../common/repositories/license.repository';
import { LicenseModule } from '../license/license.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LicensesController } from './licenses.controller';
import { LicensesService } from './licenses.service';

@Module({
  imports: [LicenseModule, PrismaModule, HttpModule],
  controllers: [LicensesController],
  providers: [LicenseRepository, LicensesService],
  exports: [LicensesService],
})
export class LicensesModule {}
