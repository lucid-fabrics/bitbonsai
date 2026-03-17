import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FileWatcherService } from './file-watcher.service';

@Module({
  imports: [PrismaModule],
  providers: [FileWatcherService],
  exports: [FileWatcherService],
})
export class FileWatcherModule {}
