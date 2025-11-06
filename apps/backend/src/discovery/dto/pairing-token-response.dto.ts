import { ApiProperty } from '@nestjs/swagger';

/**
 * PairingTokenResponseDto
 *
 * Response after requesting pairing with a MAIN node.
 * Contains the 6-digit pairing token to complete pairing.
 */
export class PairingTokenResponseDto {
  @ApiProperty({
    description: '6-digit pairing token',
    example: '123456',
  })
  pairingToken!: string;

  @ApiProperty({
    description: 'When the token expires',
    example: '2025-01-05T12:10:00Z',
  })
  expiresAt!: Date;

  @ApiProperty({
    description: 'Main node URL',
    example: 'http://192.168.1.100:3100',
  })
  mainNodeUrl!: string;
}
