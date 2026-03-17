import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for codec usage distribution across the media library
 */
export class CodecEntryDto {
  @ApiProperty({
    description: 'Codec name (e.g., H.264, HEVC, AV1)',
    example: 'HEVC',
  })
  codec!: string;

  @ApiProperty({
    description: 'Number of files using this codec',
    example: 245,
    minimum: 0,
  })
  count!: number;

  @ApiProperty({
    description: 'Percentage of total files using this codec',
    example: 34.2,
    minimum: 0,
    maximum: 100,
  })
  percentage!: number;
}

/**
 * Response DTO for codec distribution endpoint
 */
export class CodecDistributionDto {
  @ApiProperty({
    description: 'Array of codec usage entries',
    type: [CodecEntryDto],
    example: [
      { codec: 'H.264', count: 425, percentage: 59.4 },
      { codec: 'HEVC', count: 245, percentage: 34.2 },
      { codec: 'AV1', count: 38, percentage: 5.3 },
      { codec: 'VP9', count: 8, percentage: 1.1 },
    ],
  })
  distribution!: CodecEntryDto[];

  @ApiProperty({
    description: 'Total number of files analyzed',
    example: 716,
    minimum: 0,
  })
  totalFiles!: number;

  @ApiProperty({
    description: 'Timestamp when distribution was calculated',
    example: '2024-09-30T21:45:32.123Z',
    format: 'date-time',
  })
  timestamp!: string;
}
