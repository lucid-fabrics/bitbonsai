import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

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
  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, {
    message: 'Pairing token must be a 6-digit number',
  })
  pairingToken!: string;
}
