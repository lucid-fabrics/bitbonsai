import { ApiProperty } from '@nestjs/swagger';
import { NetworkLocation } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * DTO for updating node configuration
 */
export class UpdateNodeDto {
  @ApiProperty({
    description: 'Display name for the node',
    example: 'Main Encoding Server',
    minLength: 1,
    maxLength: 255,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Node name must be a string' })
  @Length(1, 255, { message: 'Node name must be between 1 and 255 characters' })
  name?: string;

  @ApiProperty({
    description: 'Whether this node has access to shared storage (NFS/SMB)',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'hasSharedStorage must be a boolean' })
  hasSharedStorage?: boolean;

  @ApiProperty({
    description: 'Maximum number of concurrent encoding jobs',
    example: 2,
    minimum: 1,
    maximum: 20,
    default: 1,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'maxWorkers must be an integer' })
  @Min(1, { message: 'maxWorkers must be at least 1' })
  @Max(20, { message: 'maxWorkers cannot exceed 20' })
  maxWorkers?: number;

  @ApiProperty({
    description: 'Maximum CPU usage percentage (reserves resources for host system)',
    example: 80,
    minimum: 10,
    maximum: 100,
    default: 80,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'cpuLimit must be an integer' })
  @Min(10, { message: 'cpuLimit must be at least 10%' })
  @Max(100, { message: 'cpuLimit cannot exceed 100%' })
  cpuLimit?: number;

  @ApiProperty({
    description: 'Public URL for accessing this node (required for LINKED nodes)',
    example: 'http://192.168.1.121:3100',
    required: false,
  })
  @IsOptional()
  @IsUrl({}, { message: 'publicUrl must be a valid URL' })
  publicUrl?: string;

  @ApiProperty({
    description: 'Main node API URL (for LINKED nodes only)',
    example: 'http://192.168.1.100:3100/api/v1',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'mainNodeUrl must be a string' })
  mainNodeUrl?: string;

  @ApiProperty({
    description: 'Network location of the node (LOCAL, REMOTE, or UNKNOWN)',
    enum: NetworkLocation,
    example: NetworkLocation.LOCAL,
    required: false,
  })
  @IsOptional()
  @IsEnum(NetworkLocation, { message: 'networkLocation must be LOCAL, REMOTE, or UNKNOWN' })
  networkLocation?: NetworkLocation;
}
