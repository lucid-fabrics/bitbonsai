import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/**
 * DTO for updating job priority
 *
 * Priority levels:
 * - 0 = Normal (default)
 * - 1 = High
 * - 2 = Top Priority (max 3 at once)
 */
export class UpdatePriorityDto {
  @ApiProperty({
    description:
      'Job priority level (0=normal, 1=high, 2=top). Max 3 jobs can have top priority at once.',
    example: 2,
    minimum: 0,
    maximum: 2,
    required: true,
  })
  @IsInt()
  @Min(0)
  @Max(2)
  priority!: number;
}
