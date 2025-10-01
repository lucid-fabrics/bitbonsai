import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LibrariesController } from './libraries.controller';
import { LibrariesService } from './libraries.service';

/**
 * LibrariesModule
 *
 * Provides complete CRUD API for managing media libraries.
 * Includes Prisma database integration.
 */
@Module({
  controllers: [LibrariesController],
  providers: [LibrariesService, PrismaService],
  exports: [LibrariesService],
})
export class LibrariesModule {}
