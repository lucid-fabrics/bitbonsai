import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO for complete pairing operation
 */
export class CompletePairingResponseDto {
  @ApiProperty({
    description: 'Success status of pairing completion',
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: 'Node ID that was paired',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  nodeId!: string;

  @ApiProperty({
    description: 'Result message',
    example: 'Node paired successfully',
  })
  message!: string;
}
