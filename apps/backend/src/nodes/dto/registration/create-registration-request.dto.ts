import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

/**
 * DTO for creating a registration request from a CHILD node
 */
export class CreateRegistrationRequestDto {
  @ApiProperty({
    description: 'ID of the MAIN node to register with',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @IsNotEmpty()
  @IsString()
  mainNodeId!: string;

  @ApiProperty({
    description: 'Display name for the child node',
    example: 'Encoding Server 2',
    minLength: 1,
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  childNodeName!: string;

  @ApiProperty({
    description: 'Optional message to the MAIN node administrator',
    example: 'This is my dedicated GPU encoding server',
    required: false,
  })
  @IsOptional()
  @IsString()
  message?: string;
}
