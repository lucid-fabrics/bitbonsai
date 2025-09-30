import { Controller, Get, Post } from '@nestjs/common';
import { MediaStatsService } from './media-stats.service';
import { MediaStatsDto } from './dto/media-stats.dto';

@Controller('media-stats')
export class MediaStatsController {
  constructor(private readonly mediaStatsService: MediaStatsService) {}

  @Get()
  async getStats(): Promise<MediaStatsDto> {
    return this.mediaStatsService.getMediaStats();
  }

  @Post('scan')
  async triggerScan(): Promise<void> {
    return this.mediaStatsService.triggerScan();
  }
}
