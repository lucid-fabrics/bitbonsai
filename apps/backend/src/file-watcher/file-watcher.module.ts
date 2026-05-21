import { Module } from '@nestjs/common';
import { LibraryRepository } from '../common/repositories/library.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { FileWatcherService } from './file-watcher.service';

@Module({
  imports: [PrismaModule],
  providers: [FileWatcherService, LibraryRepository],
  exports: [FileWatcherService],
})
export class FileWatcherModule {}
