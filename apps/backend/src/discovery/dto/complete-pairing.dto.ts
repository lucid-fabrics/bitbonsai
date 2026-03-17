import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl, Length } from 'class-validator';

/**
 * CompletePairingDto
 *
 * Request body for completing pairing with a MAIN node.
 */
export class CompletePairingDto {
  @ApiProperty({
    description: 'Base URL of the MAIN node',
    example: 'http://192.168.1.100:3100',
  })
  @IsUrl()
  @IsNotEmpty()
  mainNodeUrl!: string;

  @ApiProperty({
    description: '6-digit pairing token',
    example: '123456',
  })
  @IsString()
  @Length(6, 6)
  @IsNotEmpty()
  pairingToken!: string;
}
