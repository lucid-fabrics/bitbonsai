import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FolderFilesDto } from './dto/file-info.dto';
import { MediaStatsDto } from './dto/media-stats.dto';
import { MediaStatsService } from './media-stats.service';

@ApiTags('media-stats')
@Controller('media-stats')
export class MediaStatsController {
  constructor(private readonly mediaStatsService: MediaStatsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get media library statistics',
    description:
      'Returns comprehensive analytics about your media library including:\n' +
      '- **Codec Distribution**: Breakdown of H.264, H.265/HEVC, AV1, and other codecs\n' +
      '- **Total Library Size**: Storage usage across all configured media directories\n' +
      '- **Total File Count**: Number of video files in the library\n' +
      '- **Average Bitrate**: Mean bitrate across all media files\n' +
      '- **Folder Statistics**: Per-folder breakdown of size, file count, and codec usage\n' +
      '- **Potential Savings**: Estimated space savings from H.265 re-encoding\n\n' +
      '**Configuration**: Set `MEDIA_PATHS` environment variable to specify directories to scan.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved media library statistics',
    type: MediaStatsDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while scanning media library',
  })
  async getStats(): Promise<MediaStatsDto> {
    return this.mediaStatsService.getMediaStats();
  }

  @Post('scan')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Trigger media library scan',
    description:
      'Initiates a scan of all configured media directories. The scan process:\n' +
      '1. **Discovers** all video files in `MEDIA_PATHS` directories\n' +
      '2. **Analyzes** files using ffprobe to detect codec, bitrate, and size\n' +
      '3. **Calculates** total storage, file counts, and codec distribution\n' +
      '4. **Updates** the statistics cache for the GET `/media-stats` endpoint\n\n' +
      '**Response**: Returns `202 Accepted` immediately while the scan runs synchronously.',
  })
  @ApiResponse({
    status: 202,
    description: 'Media library scan completed successfully.',
  })
  @ApiBadRequestResponse({
    description: 'No media paths configured or paths are inaccessible',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while initiating media scan',
  })
  async triggerScan(): Promise<void> {
    return this.mediaStatsService.triggerScan();
  }

  @Get('folders/:folderName/files')
  @ApiOperation({
    summary: 'Get files by codec for a specific folder',
    description:
      'Returns a list of video files in the specified folder filtered by codec type. ' +
      'This is useful for identifying files that need to be re-encoded.\n\n' +
      '**Use Case**: Display H.264 files that can be re-encoded to H.265 for space savings.\n\n' +
      '**Performance**: Results are computed on-demand by scanning the folder.',
  })
  @ApiParam({
    name: 'folderName',
    description: 'Name of the media folder (e.g., "TV", "Movies", "Anime")',
    example: 'Movies',
  })
  @ApiQuery({
    name: 'codec',
    description: 'Filter files by codec type',
    example: 'h264',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved file list',
    type: FolderFilesDto,
  })
  @ApiNotFoundResponse({
    description: 'Folder not found or not configured in MEDIA_PATHS',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while retrieving file list',
  })
  async getFolderFiles(
    @Param('folderName') folderName: string,
    @Query('codec') codec?: string
  ): Promise<FolderFilesDto> {
    return this.mediaStatsService.getFolderFiles(folderName, codec);
  }
}
