import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

/**
 * RequestPairingDto
 *
 * Request body for initiating pairing with a MAIN node.
 */
export class RequestPairingDto {
  @ApiProperty({
    description: 'Base URL of the MAIN node',
    example: 'http://192.168.1.100:3100',
  })
  @IsUrl()
  @IsNotEmpty()
  mainNodeUrl!: string;

  @ApiProperty({
    description: 'Node ID of the MAIN node',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @IsString()
  @IsNotEmpty()
  mainNodeId!: string;
}
