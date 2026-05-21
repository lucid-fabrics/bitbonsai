import { Module } from '@nestjs/common';
import { LibrariesModule } from '../libraries/libraries.module';
import { MediaStatsController } from './media-stats.controller';
import { MediaStatsService } from './media-stats.service';

/**
 * MediaStatsModule
 *
 * Provides media statistics and analysis services.
 * Uses LibrariesModule to derive media paths from database.
 */
@Module({
  imports: [LibrariesModule],
  controllers: [MediaStatsController],
  providers: [MediaStatsService],
})
export class MediaStatsModule {}
