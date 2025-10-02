import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for creating a new encoding job
 */
export class CreateJobDto {
  @ApiProperty({
    description: 'Full path to the media file to be encoded',
    example: '/mnt/user/media/Movies/Avatar (2009)/Avatar.mkv',
  })
  @IsNotEmpty()
  @IsString()
  filePath!: string;

  @ApiProperty({
    description: 'User-friendly file label for display in UI',
    example: 'Avatar (2009).mkv',
  })
  @IsNotEmpty()
  @IsString()
  fileLabel!: string;

  @ApiProperty({
    description: 'Current codec of the source file',
    example: 'H.264',
  })
  @IsNotEmpty()
  @IsString()
  sourceCodec!: string;

  @ApiProperty({
    description: 'Target codec for encoding',
    example: 'HEVC',
  })
  @IsNotEmpty()
  @IsString()
  targetCodec!: string;

  @ApiProperty({
    description: 'Original file size in bytes',
    example: 10737418240,
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  beforeSizeBytes!: string;

  @ApiProperty({
    description: 'ID of the node that will process this job',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @IsNotEmpty()
  @IsString()
  nodeId!: string;

  @ApiProperty({
    description: 'ID of the library this file belongs to',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  @IsNotEmpty()
  @IsString()
  libraryId!: string;

  @ApiProperty({
    description: 'ID of the encoding policy to apply',
    example: 'clq8x9z8x0004qh8x9z8x0004',
  })
  @IsNotEmpty()
  @IsString()
  policyId!: string;
}
