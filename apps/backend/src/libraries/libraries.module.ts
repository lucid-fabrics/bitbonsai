import { forwardRef, Module } from '@nestjs/common';
import { FileWatcherModule } from '../file-watcher/file-watcher.module';
import { PrismaService } from '../prisma/prisma.service';
import { LibrariesController } from './libraries.controller';
import { LibrariesService } from './libraries.service';

/**
 * LibrariesModule
 *
 * Provides complete CRUD API for managing media libraries.
 * Includes Prisma database integration and file watching capabilities.
 */
@Module({
  imports: [forwardRef(() => FileWatcherModule)],
  controllers: [LibrariesController],
  providers: [LibrariesService, PrismaService],
  exports: [LibrariesService],
})
export class LibrariesModule {}
