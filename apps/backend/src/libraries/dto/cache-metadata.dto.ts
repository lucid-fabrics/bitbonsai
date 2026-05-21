import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for cache metadata information
 */
export class CacheMetadataDto {
  @ApiProperty({
    description: 'Age of the cache in seconds',
    example: 150,
  })
  cacheAgeSeconds!: number;

  @ApiProperty({
    description: 'Cache TTL in minutes',
    example: 5,
  })
  cacheTtlMinutes!: number;

  @ApiProperty({
    description: 'Whether the cache is still valid (within TTL)',
    example: true,
  })
  cacheValid!: boolean;

  @ApiProperty({
    description: 'Timestamp when cache was last updated (null if never cached)',
    example: '2025-11-04T10:30:00Z',
    nullable: true,
  })
  cacheTimestamp!: Date | null;
}
