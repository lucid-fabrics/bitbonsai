import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for pairing a node using a pairing token
 */
export class PairNodeDto {
  @ApiProperty({
    description: '6-digit pairing code displayed on the node',
    example: '123456',
    minLength: 6,
    maxLength: 6,
    pattern: '^[0-9]{6}$',
  })
  pairingToken!: string;
}
