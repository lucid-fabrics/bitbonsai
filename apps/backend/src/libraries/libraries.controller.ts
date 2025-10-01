import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Library } from '@prisma/client';
import { CreateLibraryDto } from './dto/create-library.dto';
import { LibraryStatsDto } from './dto/library-stats.dto';
import { UpdateLibraryDto } from './dto/update-library.dto';
import { LibrariesService } from './libraries.service';

@ApiTags('libraries')
@Controller('libraries')
export class LibrariesController {
  constructor(private readonly librariesService: LibrariesService) {}

  /**
   * Create a new library
   */
  @Post()
  @ApiOperation({
    summary: 'Create a new library',
    description:
      'Creates a new media library on a specified node. A library defines:\n' +
      '- **Name**: Display name for the library\n' +
      '- **Path**: Absolute path to the media folder on the node\n' +
      '- **Media Type**: MOVIE, TV_SHOW, MIXED, or OTHER\n' +
      '- **Node**: Which node manages this library\n\n' +
      '**Validation**:\n' +
      '- Node must exist\n' +
      '- Path must be unique per node\n' +
      '- Path should be an absolute filesystem path',
  })
  @ApiCreatedResponse({
    description: 'Library created successfully',
    type: CreateLibraryDto,
  })
  @ApiNotFoundResponse({
    description: 'Node not found',
  })
  @ApiConflictResponse({
    description: 'Library with the same path already exists on this node',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while creating library',
  })
  async create(@Body() createLibraryDto: CreateLibraryDto): Promise<Library> {
    return this.librariesService.create(createLibraryDto);
  }

  /**
   * Get all libraries
   */
  @Get()
  @ApiOperation({
    summary: 'List all libraries',
    description:
      'Returns all media libraries across all nodes. Each library includes:\n' +
      '- **Basic Info**: Name, path, media type, enabled status\n' +
      '- **Node Info**: Associated node details\n' +
      '- **Statistics**: File count, total size, last scan timestamp\n' +
      '- **Counts**: Number of associated jobs and policies\n\n' +
      '**Use Case**: Dashboard overview, library management UI',
  })
  @ApiOkResponse({
    description: 'List of all libraries retrieved successfully',
    type: [LibraryStatsDto],
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching libraries',
  })
  async findAll(): Promise<Library[]> {
    return this.librariesService.findAll();
  }

  /**
   * Get a specific library by ID with statistics
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get library details with statistics',
    description:
      'Retrieves detailed information about a specific library including:\n' +
      '- **Complete Library Info**: All library properties\n' +
      '- **Node Details**: Managing node information\n' +
      '- **Applied Policies**: Encoding policies configured for this library\n' +
      '- **Job Statistics**: Total number of encoding jobs\n\n' +
      '**Use Case**: Library detail page, configuration review',
  })
  @ApiParam({
    name: 'id',
    description: 'Library unique identifier (CUID)',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  @ApiOkResponse({
    description: 'Library retrieved successfully',
    type: LibraryStatsDto,
  })
  @ApiNotFoundResponse({
    description: 'Library not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching library',
  })
  async findOne(@Param('id') id: string): Promise<LibraryStatsDto> {
    return this.librariesService.findOne(id);
  }

  /**
   * Update a library
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update a library',
    description:
      'Updates an existing library. All fields are optional (partial update).\n\n' +
      '**Updatable Fields**:\n' +
      '- **name**: Display name\n' +
      '- **path**: Filesystem path (validates uniqueness)\n' +
      '- **mediaType**: MOVIE, TV_SHOW, MIXED, OTHER\n' +
      '- **enabled**: Enable/disable library scanning\n' +
      '- **nodeId**: Move library to a different node\n\n' +
      '**Use Case**: Library configuration changes, enable/disable libraries',
  })
  @ApiParam({
    name: 'id',
    description: 'Library unique identifier (CUID)',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  @ApiOkResponse({
    description: 'Library updated successfully',
    type: UpdateLibraryDto,
  })
  @ApiNotFoundResponse({
    description: 'Library not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while updating library',
  })
  async update(
    @Param('id') id: string,
    @Body() updateLibraryDto: UpdateLibraryDto
  ): Promise<Library> {
    return this.librariesService.update(id, updateLibraryDto);
  }

  /**
   * Delete a library
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a library',
    description:
      'Permanently deletes a library from the system.\n\n' +
      '**Warning**: This action:\n' +
      '- **Deletes all associated jobs** (CASCADE)\n' +
      '- **Removes policy associations** (policies themselves are preserved)\n' +
      '- **Cannot be undone**\n\n' +
      '**Use Case**: Removing unused libraries, cleanup after node decommission',
  })
  @ApiParam({
    name: 'id',
    description: 'Library unique identifier (CUID)',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  @ApiOkResponse({
    description: 'Library deleted successfully (returns 204 No Content)',
  })
  @ApiNotFoundResponse({
    description: 'Library not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while deleting library',
  })
  async remove(@Param('id') id: string): Promise<void> {
    return this.librariesService.remove(id);
  }

  /**
   * Trigger a library scan
   */
  @Post(':id/scan')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Trigger library scan',
    description:
      'Initiates a scan of the library filesystem. The scan process:\n' +
      '1. **Discovers** all media files in the library path\n' +
      '2. **Analyzes** files for codec, size, and encoding candidates\n' +
      '3. **Updates** totalFiles and totalSizeBytes statistics\n' +
      '4. **Queues** encoding jobs based on applied policies\n' +
      '5. **Updates** lastScanAt timestamp\n\n' +
      '**Response**: Returns `202 Accepted` immediately while scan runs asynchronously.\n\n' +
      '**Use Case**: Manual library refresh, after adding new media files',
  })
  @ApiParam({
    name: 'id',
    description: 'Library unique identifier (CUID)',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  @ApiOkResponse({
    description: 'Library scan initiated successfully',
    type: LibraryStatsDto,
  })
  @ApiNotFoundResponse({
    description: 'Library not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while initiating scan',
  })
  async scan(@Param('id') id: string): Promise<Library> {
    return this.librariesService.scan(id);
  }
}
