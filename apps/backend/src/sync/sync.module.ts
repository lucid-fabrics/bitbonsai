import { Module } from '@nestjs/common';
import { LibraryRepository } from '../common/repositories/library.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { PolicyRepository } from '../common/repositories/policy.repository';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { PolicySyncService } from './policy-sync.service';
import { SyncController } from './sync.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SyncController],
  providers: [
    PolicySyncService,
    NodeRepository,
    SettingsRepository,
    PolicyRepository,
    LibraryRepository,
  ],
  exports: [PolicySyncService],
})
export class SyncModule {}
