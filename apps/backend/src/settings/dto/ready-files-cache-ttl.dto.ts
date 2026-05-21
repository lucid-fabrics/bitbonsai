import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/**
 * DTO for configuring the ready files cache TTL
 */
export class ReadyFilesCacheTtlDto {
  @ApiProperty({
    description: 'Cache TTL in minutes for /api/v1/libraries/ready endpoint',
    example: 5,
    minimum: 5,
  })
  @IsInt()
  @Min(5, { message: 'Cache TTL must be at least 5 minutes' })
  readyFilesCacheTtlMinutes!: number;
}
