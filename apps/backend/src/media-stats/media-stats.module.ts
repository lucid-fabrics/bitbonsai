import { Module } from '@nestjs/common';
import { MediaStatsController } from './media-stats.controller';
import { MediaStatsService } from './media-stats.service';

@Module({
  controllers: [MediaStatsController],
  providers: [MediaStatsService],
})
export class MediaStatsModule {}
