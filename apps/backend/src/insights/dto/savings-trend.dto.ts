import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for a single data point in the savings trend
 */
export class SavingsDataPointDto {
  @ApiProperty({
    description: 'Date for this data point',
    example: '2024-09-30',
    format: 'date',
  })
  date!: string;

  @ApiProperty({
    description: 'Bytes saved on this date (as string for BigInt support)',
    example: '5368709120',
    format: 'int64',
  })
  savedBytes!: string;

  @ApiProperty({
    description: 'Bytes saved in gigabytes',
    example: 5.0,
    minimum: 0,
  })
  savedGB!: number;

  @ApiProperty({
    description: 'Number of jobs completed on this date',
    example: 42,
    minimum: 0,
  })
  jobsCompleted!: number;
}

/**
 * Response DTO for savings trend endpoint
 */
export class SavingsTrendDto {
  @ApiProperty({
    description: 'Array of daily savings data points',
    type: [SavingsDataPointDto],
    example: [
      { date: '2024-09-25', savedBytes: '5368709120', savedGB: 5.0, jobsCompleted: 42 },
      { date: '2024-09-26', savedBytes: '6442450944', savedGB: 6.0, jobsCompleted: 38 },
      { date: '2024-09-27', savedBytes: '4831838208', savedGB: 4.5, jobsCompleted: 35 },
    ],
  })
  trend!: SavingsDataPointDto[];

  @ApiProperty({
    description: 'Total bytes saved across the entire period',
    example: '107374182400',
    format: 'int64',
  })
  totalSavedBytes!: string;

  @ApiProperty({
    description: 'Total bytes saved in gigabytes',
    example: 100.0,
    minimum: 0,
  })
  totalSavedGB!: number;

  @ApiProperty({
    description: 'Number of days in the trend',
    example: 30,
    minimum: 1,
  })
  days!: number;

  @ApiProperty({
    description: 'Timestamp when trend was calculated',
    example: '2024-09-30T21:45:32.123Z',
    format: 'date-time',
  })
  timestamp!: string;
}
