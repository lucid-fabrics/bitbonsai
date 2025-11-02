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
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { LibraryFilesDto } from './dto/library-files.dto';
import { LibraryStatsDto } from './dto/library-stats.dto';
import {
  BulkJobCreationResultDto,
  CreateAllJobsDto,
  CreateJobsFromScanDto,
  ScanPreviewDto,
} from './dto/scan-preview.dto';
import { UpdateLibraryDto } from './dto/update-library.dto';
import { LibrariesService } from './libraries.service';

@ApiTags('libraries')
@ApiBearerAuth('JWT-auth')
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
   * Get all "ready to queue" files across all libraries
   */
  @Get('ready')
  @ApiOperation({
    summary: 'Get all ready files',
    description:
      '**Aggregate Ready Files** - Shows all files ready to be queued across all libraries.\n\n' +
      'Returns scan preview data from all enabled libraries:\n' +
      '- Aggregates files from all libraries with policies\n' +
      "- Shows files that need encoding but haven't been queued yet\n" +
      '- Excludes blacklisted files\n' +
      '- Useful for the "Ready" filter in the queue page\n\n' +
      '**Response**: Array of scan previews, one per library',
  })
  @ApiOkResponse({
    description: 'Ready files retrieved successfully',
    type: [ScanPreviewDto],
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching ready files',
  })
  async getAllReadyFiles(): Promise<ScanPreviewDto[]> {
    return this.librariesService.getAllReadyFiles();
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
   * Get all video files in a library
   */
  @Get(':id/files')
  @ApiOperation({
    summary: 'Get all video files in library',
    description:
      '**Browse Library Files** - Shows ALL video files in the library folder.\n\n' +
      'This endpoint:\n' +
      '- Scans the library directory recursively for video files\n' +
      '- Analyzes each file with FFprobe to get metadata\n' +
      '- Returns file details: codec, resolution, size, duration\n' +
      '- Includes file health status\n\n' +
      '**Use Case**: Browse and review all files in a library, not just ones needing encoding',
  })
  @ApiParam({
    name: 'id',
    description: 'Library unique identifier (CUID)',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  @ApiOkResponse({
    description: 'Library files retrieved successfully',
    type: LibraryFilesDto,
  })
  @ApiNotFoundResponse({
    description: 'Library not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while fetching library files',
  })
  async getLibraryFiles(@Param('id') id: string): Promise<LibraryFilesDto> {
    return this.librariesService.getLibraryFiles(id);
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
  @ApiBadRequestResponse({
    description: 'Invalid library data provided',
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
  @ApiBadRequestResponse({
    description: 'Library is disabled or node is offline',
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

  /**
   * Preview what files need encoding (without creating jobs)
   */
  @Get(':id/scan/preview')
  @ApiOperation({
    summary: 'Preview scan results',
    description:
      '**Intuitive Scan Preview** - Shows what will be encoded WITHOUT creating jobs.\n\n' +
      'This endpoint provides a clear breakdown:\n' +
      '- **Files Needing Encoding**: Shows codec (e.g., H.264 → HEVC)\n' +
      '- **Already Optimized Files**: No action needed\n' +
      '- **File Details**: Size, duration, resolution\n' +
      '- **Errors**: Files that failed analysis\n\n' +
      '**User Flow**:\n' +
      '1. User clicks "Scan Library"\n' +
      '2. System analyzes files with FFprobe\n' +
      '3. Shows preview: "51 files need encoding, 45 already optimized"\n' +
      '4. User clicks "Create Jobs" to proceed\n\n' +
      '**Why This Design?**\n' +
      '- Users see exactly what will happen\n' +
      '- No surprise jobs appearing\n' +
      '- Manual confirmation step for control',
  })
  @ApiParam({
    name: 'id',
    description: 'Library unique identifier (CUID)',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  @ApiOkResponse({
    description: 'Scan preview generated successfully',
    type: ScanPreviewDto,
  })
  @ApiBadRequestResponse({
    description: 'Library has no encoding policy assigned',
  })
  @ApiNotFoundResponse({
    description: 'Library not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred during scan',
  })
  async scanPreview(@Param('id') id: string): Promise<ScanPreviewDto> {
    return this.librariesService.scanPreview(id);
  }

  /**
   * Create encoding jobs from scan results
   */
  @Post(':id/scan/create-jobs')
  @ApiOperation({
    summary: 'Create jobs from scan preview',
    description:
      '**Manual Trigger** - Creates encoding jobs after user reviews scan preview.\n\n' +
      'Takes the scan preview results and creates actual jobs:\n' +
      '- Validates policy and library\n' +
      '- Creates job for each file that needs encoding\n' +
      '- Jobs appear in queue immediately\n' +
      '- Nodes can start processing\n\n' +
      '**Flexible Options**:\n' +
      '- Leave `filePaths` empty to encode ALL files from preview\n' +
      '- Provide specific `filePaths` array to cherry-pick files\n\n' +
      '**Response**: Returns number of jobs created + job details',
  })
  @ApiParam({
    name: 'id',
    description: 'Library unique identifier (CUID)',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  @ApiCreatedResponse({
    description: 'Jobs created successfully',
    schema: {
      type: 'object',
      properties: {
        jobsCreated: { type: 'number', example: 51 },
        jobs: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid request or library has no policy',
  })
  @ApiNotFoundResponse({
    description: 'Library or policy not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while creating jobs',
  })
  async createJobsFromScan(
    @Param('id') id: string,
    @Body() dto: CreateJobsFromScanDto
  ): Promise<{ jobsCreated: number; jobs: any[] }> {
    return this.librariesService.createJobsFromScan(id, dto.policyId, dto.filePaths);
  }

  /**
   * Create jobs for all files in library (simplified workflow)
   */
  @Post(':id/create-all-jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Create jobs for all files in library',
    description:
      '**Simplified Bulk Job Creation** - Creates jobs for all files that need encoding in a library.\n\n' +
      'This endpoint:\n' +
      '1. Scans the library directory for video files (fast)\n' +
      '2. For each file:\n' +
      '   - Skips if already in queue or completed\n' +
      '   - Quick codec check using FFprobe\n' +
      '   - Creates job if needs encoding\n' +
      '   - Skips corrupted/failed files\n' +
      '3. Returns summary of jobs created and files skipped\n\n' +
      '**Use Case**: Simplified "Add All Files" workflow that beats Tdarr/Unmanic',
  })
  @ApiParam({
    name: 'id',
    description: 'Library unique identifier (CUID)',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  @ApiCreatedResponse({
    description: 'Jobs created successfully',
    type: BulkJobCreationResultDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid request or library not found',
  })
  @ApiNotFoundResponse({
    description: 'Library or policy not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while creating jobs',
  })
  async createAllJobs(
    @Param('id') id: string,
    @Body() dto: CreateAllJobsDto
  ): Promise<BulkJobCreationResultDto> {
    return this.librariesService.createAllJobs(id, dto.policyId);
  }
}
