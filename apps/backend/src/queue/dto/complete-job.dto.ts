import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

/**
 * DTO for completing an encoding job
 */
export class CompleteJobDto {
  @ApiProperty({
    description: 'Size of the encoded file in bytes',
    example: 5368709120,
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  afterSizeBytes!: string;

  @ApiProperty({
    description: 'Bytes saved compared to original (can be negative if larger)',
    example: 5368709120,
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  savedBytes!: string;

  @ApiProperty({
    description: 'Percentage of space saved',
    example: 50.0,
  })
  @IsNotEmpty()
  @IsNumber()
  savedPercent!: number;
}
