import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsString, Max, Min } from 'class-validator';

/**
 * EncodingProgressDto
 *
 * Real-time encoding progress information parsed from ffmpeg output.
 * Emitted during encoding jobs to track progress and performance.
 *
 * @example
 * {
 *   jobId: "clx123abc",
 *   frame: 2450,
 *   fps: 87.3,
 *   currentTime: "00:01:42.50",
 *   progress: 42.5,
 *   eta: 138
 * }
 */
export class EncodingProgressDto {
  @ApiProperty({
    description: 'Job unique identifier',
    example: 'clx123abc',
  })
  @IsString()
  jobId!: string;

  @ApiProperty({
    description: 'Current frame number being processed',
    example: 2450,
  })
  @IsInt()
  @Min(0)
  frame!: number;

  @ApiProperty({
    description: 'Frames per second processing speed',
    example: 87.3,
  })
  @IsNumber()
  @Min(0)
  fps!: number;

  @ApiProperty({
    description: 'Current time position in video (HH:MM:SS.MS)',
    example: '00:01:42.50',
  })
  @IsString()
  currentTime!: string;

  @ApiProperty({
    description: 'Encoding progress percentage (0-100)',
    example: 42.5,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  progress!: number;

  @ApiProperty({
    description: 'Estimated time remaining in seconds',
    example: 138,
    required: false,
  })
  @IsInt()
  @Min(0)
  eta?: number;
}
