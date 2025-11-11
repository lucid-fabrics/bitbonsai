import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

/**
 * DTO for rejecting a registration request
 */
export class RejectRequestDto {
  @ApiProperty({
    description: 'Reason for rejecting the request',
    example: 'Unauthorized device',
    minLength: 1,
    maxLength: 500,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 500)
  reason!: string;
}
