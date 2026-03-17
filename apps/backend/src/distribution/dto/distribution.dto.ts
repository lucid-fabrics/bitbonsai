import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class AssignJobDto {
  @ApiPropertyOptional({
    description: 'Target node ID. If not provided, optimal node will be selected automatically.',
  })
  @IsString()
  @IsOptional()
  nodeId?: string;
}

export class UpdateConfigDto {
  @ApiPropertyOptional({
    description: 'Weight for real-time load factor (0-30 pts base)',
    minimum: 0,
    maximum: 5,
  })
  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  weightRealTimeLoad?: number;

  @ApiPropertyOptional({
    description: 'Weight for queue depth factor (0-20 pts base)',
  })
  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  weightQueueDepth?: number;

  @ApiPropertyOptional({
    description: 'Weight for hardware capability (0-25 pts base)',
  })
  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  weightHardware?: number;

  @ApiPropertyOptional({
    description: 'Weight for historical performance (0-25 pts base)',
  })
  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  weightPerformance?: number;

  @ApiPropertyOptional({
    description: 'Weight for job stickiness penalty (-20 pts base)',
  })
  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  weightStickiness?: number;

  @ApiPropertyOptional({
    description: 'Weight for transfer cost penalty (-25 pts base)',
  })
  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  weightTransferCost?: number;

  @ApiPropertyOptional({
    description: 'Weight for codec/HW match (0-20 pts base)',
  })
  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  weightCodecMatch?: number;

  @ApiPropertyOptional({
    description: 'Weight for library affinity bonus (0-10 pts base)',
  })
  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  weightLibraryAffinity?: number;

  @ApiPropertyOptional({
    description: 'Weight for reliability penalty (-15 pts base)',
  })
  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  weightReliability?: number;

  @ApiPropertyOptional({
    description: 'Weight for ETA balancing (0-15 pts base)',
  })
  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  weightETABalance?: number;

  @ApiPropertyOptional({
    description: 'Weight for file size spreading (0-15 pts base)',
  })
  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  weightFileSizeSpread?: number;

  @ApiPropertyOptional({
    description: 'Minimum minutes before job can migrate',
    minimum: 0,
    maximum: 60,
  })
  @IsNumber()
  @Min(0)
  @Max(60)
  @IsOptional()
  stickinessMinutes?: number;

  @ApiPropertyOptional({
    description: 'Enable ETA-based distribution',
  })
  @IsBoolean()
  @IsOptional()
  enableETABalancing?: boolean;

  @ApiPropertyOptional({
    description: 'Enable file size spreading',
  })
  @IsBoolean()
  @IsOptional()
  enableFileSizeSpread?: boolean;

  @ApiPropertyOptional({
    description: 'Enable library affinity bonus',
  })
  @IsBoolean()
  @IsOptional()
  enableLibraryAffinity?: boolean;

  @ApiPropertyOptional({
    description: 'Minimum score improvement needed to migrate job',
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  migrationScoreThreshold?: number;

  @ApiPropertyOptional({
    description: 'Maximum migrations allowed per job',
    minimum: 0,
    maximum: 10,
  })
  @IsNumber()
  @Min(0)
  @Max(10)
  @IsOptional()
  maxMigrationsPerJob?: number;

  @ApiPropertyOptional({
    description: 'Cache TTL for node scores in seconds',
    minimum: 10,
    maximum: 600,
  })
  @IsNumber()
  @Min(10)
  @Max(600)
  @IsOptional()
  scoreCacheTtlSeconds?: number;
}
