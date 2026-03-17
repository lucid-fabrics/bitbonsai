import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO for approve node operation
 */
export class ApproveNodeResponseDto {
  @ApiProperty({
    description: 'Success status of approval',
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: 'Approved node ID',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  nodeId!: string;

  @ApiProperty({
    description: 'Result message',
    example: 'Node approved successfully',
  })
  message!: string;
}
