import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RevokeLicenseDto {
  @ApiProperty({ example: 'Payment refunded' })
  @IsString()
  reason: string;
}
