import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString } from 'class-validator';

/**
 * DTO for querying time-series metrics with optional filters
 */
export class TimeSeriesQueryDto {
  @ApiProperty({
    description: 'Start date for the time range (ISO 8601 format)',
    example: '2024-01-01T00:00:00Z',
    format: 'date-time',
    required: true,
  })
  @Type(() => Date)
  @IsDate()
  startDate!: Date;

  @ApiProperty({
    description: 'End date for the time range (ISO 8601 format)',
    example: '2024-12-31T23:59:59Z',
    format: 'date-time',
    required: true,
  })
  @Type(() => Date)
  @IsDate()
  endDate!: Date;

  @ApiProperty({
    description: 'Optional node ID to filter metrics for a specific node',
    example: 'clq8x9z8x0002qh8x9z8x0002',
    required: false,
  })
  @IsOptional()
  @IsString()
  nodeId?: string;

  @ApiProperty({
    description: 'Optional license ID to filter metrics for a specific license',
    example: 'clq8x9z8x0001qh8x9z8x0001',
    required: false,
  })
  @IsOptional()
  @IsString()
  licenseId?: string;
}
