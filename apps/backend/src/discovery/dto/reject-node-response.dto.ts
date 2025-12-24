import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO for reject node operation
 */
export class RejectNodeResponseDto {
  @ApiProperty({
    description: 'Success status of rejection',
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: 'Rejected node ID',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  nodeId!: string;

  @ApiProperty({
    description: 'Result message',
    example: 'Node rejected successfully',
  })
  message!: string;
}
