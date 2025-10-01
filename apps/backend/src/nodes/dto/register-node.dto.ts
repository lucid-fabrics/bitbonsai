import { ApiProperty } from '@nestjs/swagger';
import { AccelerationType } from '@prisma/client';

/**
 * DTO for registering a new node
 */
export class RegisterNodeDto {
  @ApiProperty({
    description: 'Display name for the node',
    example: 'Main Encoding Server',
    minLength: 1,
    maxLength: 255,
  })
  name!: string;

  @ApiProperty({
    description: 'License key to validate and associate with the node',
    example: 'BB-XXXX-XXXX-XXXX-XXXX',
    minLength: 19,
    maxLength: 255,
  })
  licenseKey!: string;

  @ApiProperty({
    description: 'BitBonsai version running on the node',
    example: '1.0.0',
  })
  version!: string;

  @ApiProperty({
    description: 'Hardware acceleration type available on the node',
    enum: AccelerationType,
    example: AccelerationType.NVIDIA,
    enumName: 'AccelerationType',
  })
  acceleration!: AccelerationType;
}
