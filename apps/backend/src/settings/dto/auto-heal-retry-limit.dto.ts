import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/**
 * DTO for auto-heal retry limit setting
 *
 * Controls the maximum number of retry attempts for auto-heal to resurrect failed jobs.
 * Jobs that exceed this retry count will not be automatically healed on backend restart.
 */
export class AutoHealRetryLimitDto {
  @ApiProperty({
    description:
      'Maximum retry count for auto-heal to resurrect failed jobs. Jobs exceeding this limit will not be automatically healed. Minimum: 3, Default: 15',
    example: 15,
    minimum: 3,
  })
  @IsInt()
  @Min(3)
  maxAutoHealRetries!: number;
}
