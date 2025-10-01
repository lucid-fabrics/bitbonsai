import { Injectable, NotImplementedException } from '@nestjs/common';
import { MediaStatsDto } from './dto/media-stats.dto';

@Injectable()
export class MediaStatsService {
  async getMediaStats(): Promise<MediaStatsDto> {
    throw new NotImplementedException(
      'Media scanning not yet implemented. This endpoint will scan configured media directories ' +
      '(from MEDIA_PATHS environment variable, default: /media), use ffprobe to analyze video ' +
      'codec information, calculate file sizes and bitrates, and return actual statistics from ' +
      'your media library. No mock data is returned per project guidelines.'
    );
  }

  async triggerScan(): Promise<void> {
    throw new NotImplementedException(
      'Media scan trigger not yet implemented. This endpoint will initiate a background scan ' +
      'of all configured media directories, detect video files, analyze codecs with ffprobe, ' +
      'and update statistics. Consider using a job queue (e.g., BullMQ) for long-running scans.'
    );
  }
}
