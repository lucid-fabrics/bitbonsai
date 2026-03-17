import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * DTO for manually delegating a job to a specific node
 */
export class DelegateJobDto {
  @ApiProperty({
    description: 'Target node ID to delegate the job to',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^c[a-z0-9]{24}$/, {
    message: 'targetNodeId must be a valid CUID',
  })
  targetNodeId!: string;
}
