import { Module } from '@nestjs/common';
import { MediaStatsModule } from './media-stats/media-stats.module';

@Module({
  imports: [MediaStatsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
