import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FilesystemService } from './filesystem.service';

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
  @ApiOkResponse({
    description: 'Directory listing retrieved',
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
  @ApiBadRequestResponse({ description: 'Invalid path' })
  @ApiInternalServerErrorResponse({ description: 'Failed to browse directory' })
  async browseDirectories(@Query('path') path?: string) {
    return this.filesystemService.listDirectories(path || '/');
  }
}
