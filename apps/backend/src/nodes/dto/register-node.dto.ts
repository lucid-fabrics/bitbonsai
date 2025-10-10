import { ApiProperty } from '@nestjs/swagger';
import { AccelerationType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, Length, Matches } from 'class-validator';

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
  @IsNotEmpty({ message: 'Node name is required' })
  @IsString({ message: 'Node name must be a string' })
  @Length(1, 255, { message: 'Node name must be between 1 and 255 characters' })
  name!: string;

  @ApiProperty({
    description: 'License key to validate and associate with the node',
    example: 'BB-XXXX-XXXX-XXXX-XXXX',
    minLength: 19,
    maxLength: 255,
  })
  @IsNotEmpty({ message: 'License key is required' })
  @IsString({ message: 'License key must be a string' })
  @Length(11, 255, { message: 'License key must be at least 11 characters' })
  @Matches(/^[A-Z]{3}-[a-z0-9]+$/i, {
    message: 'License key must follow format: PREFIX-random (e.g., FRE-x8k2p9m4n7)',
  })
  licenseKey!: string;

  @ApiProperty({
    description: 'BitBonsai version running on the node',
    example: '1.0.0',
  })
  @IsNotEmpty({ message: 'Version is required' })
  @IsString({ message: 'Version must be a string' })
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'Version must be in semver format (e.g., 1.0.0)' })
  version!: string;

  @ApiProperty({
    description: 'Hardware acceleration type available on the node',
    enum: AccelerationType,
    example: AccelerationType.NVIDIA,
    enumName: 'AccelerationType',
  })
  @IsNotEmpty({ message: 'Acceleration type is required' })
  @IsEnum(AccelerationType, { message: 'Invalid acceleration type' })
  acceleration!: AccelerationType;
}
