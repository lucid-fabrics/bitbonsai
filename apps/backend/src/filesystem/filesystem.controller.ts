import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FilesystemService } from './filesystem.service';

@ApiTags('filesystem')
@Controller('filesystem')
export class FilesystemController {
  constructor(private readonly filesystemService: FilesystemService) {}

  @Get('browse')
  @ApiOperation({
    summary: 'Browse filesystem directories',
    description:
      'List directories at the specified path for folder selection in library configuration',
  })
  @ApiQuery({
    name: 'path',
    required: false,
    description: 'Directory path to browse (defaults to /)',
    example: '/media',
  })
  @ApiResponse({
    status: 200,
    description: 'List of directories at the specified path',
    schema: {
      example: {
        currentPath: '/media',
        parentPath: '/',
        directories: [
          { name: 'Movies', path: '/media/Movies', isAccessible: true },
          { name: 'TV', path: '/media/TV', isAccessible: true },
          { name: 'Anime', path: '/media/Anime', isAccessible: true },
        ],
      },
    },
  })
  async browseDirectories(@Query('path') path?: string) {
    return this.filesystemService.listDirectories(path || '/');
  }
}
