import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum FileHealthStatus {
  HEALTHY = 'HEALTHY',
  WARNING = 'WARNING',
  CORRUPTED = 'CORRUPTED',
  UNKNOWN = 'UNKNOWN',
}

export class VideoFileDto {
  @ApiProperty({
    description: 'Absolute file path',
    example: '/media/completed/whisparr/Movie (2024)/movie.mkv',
  })
  filePath = '';

  @ApiProperty({ description: 'File name without path', example: 'movie.mkv' })
  fileName = '';

  @ApiProperty({ description: 'Current video codec', example: 'H.264' })
  codec = '';

  @ApiProperty({ description: 'Video resolution', example: '1920x1080' })
  resolution = '';

  @ApiProperty({ description: 'Duration in seconds', example: 7200 })
  duration = 0;

  @ApiProperty({ description: 'File size in bytes', example: 10485760000 })
  sizeBytes = 0;

  @ApiProperty({
    description: 'File health status based on integrity validation',
    enum: FileHealthStatus,
    example: FileHealthStatus.HEALTHY,
  })
  healthStatus: FileHealthStatus = FileHealthStatus.UNKNOWN;

  @ApiProperty({
    description: 'Health check details/warnings if any',
    example: 'File validated successfully',
    required: false,
  })
  healthMessage?: string;

  @ApiProperty({
    description: 'Job ID if file has an existing job',
    example: 'cmh9e2o1r0001pdivc0aqeh61',
    required: false,
  })
  jobId?: string;

  @ApiProperty({
    description: 'Current job stage if file has an existing job',
    example: 'ENCODING',
    required: false,
  })
  jobStage?: string;

  @ApiProperty({
    description: 'Job progress percentage (0-100) if encoding',
    example: 45,
    required: false,
  })
  jobProgress?: number;

  @ApiProperty({
    description: 'Whether this file can be added to queue',
    example: true,
  })
  canAddToQueue = true;

  @ApiProperty({
    description: 'Reason why file cannot be added to queue',
    example: 'Already encoding',
    required: false,
  })
  blockedReason?: string;
}

export class PolicyOption {
  @ApiProperty({ description: 'Policy ID' })
  id = '';

  @ApiProperty({ description: 'Policy name' })
  name = '';

  @ApiProperty({ description: 'Policy preset' })
  preset = '';
}

export class ScanPreviewDto {
  @ApiProperty({ description: 'Library ID' })
  libraryId = '';

  @ApiProperty({ description: 'Library name' })
  libraryName = '';

  @ApiProperty({ description: 'Applied policy ID (default or first)', nullable: true })
  policyId: string | null = null;

  @ApiProperty({ description: 'Applied policy name (default or first)', nullable: true })
  policyName: string | null = null;

  @ApiProperty({ description: 'Target codec from policy', nullable: true })
  targetCodec: string | null = null;

  @ApiProperty({
    description: 'All available policies for this library',
    type: [PolicyOption],
  })
  availablePolicies: PolicyOption[] = [];

  @ApiProperty({ description: 'Total video files found' })
  totalFiles = 0;

  @ApiProperty({ description: 'Total size of all files in bytes' })
  totalSizeBytes = '0'; // bigint as string

  @ApiProperty({
    description: 'Number of files that need encoding',
  })
  needsEncodingCount = 0;

  @ApiProperty({
    description: 'Number of files already optimized',
  })
  alreadyOptimizedCount = 0;

  @ApiProperty({
    description: 'Files that need encoding (limited to first 100 for performance)',
    type: [VideoFileDto],
  })
  needsEncoding: VideoFileDto[] = [];

  @ApiProperty({
    description: 'Files already optimized (limited to first 100 for performance)',
    type: [VideoFileDto],
  })
  alreadyOptimized: VideoFileDto[] = [];

  @ApiProperty({
    description: 'Files that had errors during analysis',
  })
  errors: Array<{ filePath: string; error: string }> = [];

  @ApiProperty({
    description: 'Timestamp when scan was performed',
  })
  scannedAt: Date = new Date();
}

export class CreateJobsFromScanDto {
  @ApiProperty({
    description:
      'Policy ID to use for encoding (optional - uses library default policy if not specified)',
    example: 'cmh8ow3sy0003qgjb90r9hztu',
    required: false,
  })
  @IsOptional()
  @IsString()
  policyId?: string;

  @ApiProperty({
    description:
      'Optional: Limit to specific file paths (if empty, processes all files that need encoding)',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filePaths?: string[];
}

export class CreateAllJobsDto {
  @ApiProperty({
    description: 'Policy ID to use for encoding (required)',
    example: 'cmh8ow3sy0003qgjb90r9hztu',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  policyId = '';
}

export class BulkJobCreationResultDto {
  @ApiProperty({
    description: 'Number of jobs created successfully',
    example: 243,
  })
  jobsCreated = 0;

  @ApiProperty({
    description: 'Number of files skipped',
    example: 2,
  })
  filesSkipped = 0;

  @ApiProperty({
    description: 'List of skipped files with reasons',
    type: [Object],
    example: [
      { path: '/media/movie.mkv', reason: 'Already in queue' },
      { path: '/media/corrupted.mkv', reason: 'Failed to probe file' },
    ],
  })
  skippedFiles: Array<{ path: string; reason: string }> = [];
}
