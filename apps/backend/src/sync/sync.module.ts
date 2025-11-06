import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PolicySyncService } from './policy-sync.service';
import { SyncController } from './sync.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SyncController],
  providers: [PolicySyncService],
  exports: [PolicySyncService],
})
export class SyncModule {}
