import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Pair Request DTO
 *
 * Request body for initiating pairing between CHILD and MAIN node.
 * Used in the auto-discovery flow where child has scanned and found main nodes.
 */
export class PairRequestDto {
  @ApiProperty({
    description: 'ID of the MAIN node to pair with (from discovery scan)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @IsString()
  @IsNotEmpty()
  mainNodeId!: string;

  @ApiProperty({
    description: 'Display name for this child node',
    example: 'Encoding Node 1',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  childNodeName!: string;
}
