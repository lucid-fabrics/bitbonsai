import { Module } from '@nestjs/common';
import { LicenseRepository } from '../common/repositories/license.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { UserRepository } from '../common/repositories/user.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

@Module({
  imports: [PrismaModule],
  controllers: [SetupController],
  providers: [SetupService, LicenseRepository, NodeRepository, SettingsRepository, UserRepository],
  exports: [SetupService],
})
export class SetupModule {}
