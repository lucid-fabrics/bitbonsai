import { Module } from '@nestjs/common';
import { FileWatcherService } from './file-watcher.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [FileWatcherService],
  exports: [FileWatcherService],
})
export class FileWatcherModule {}
