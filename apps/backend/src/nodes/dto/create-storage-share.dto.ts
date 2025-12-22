import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StorageProtocol } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIP,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class CreateStorageShareDto {
  @ApiProperty({ description: 'Node ID that will use this storage share' })
  @IsString()
  @IsNotEmpty()
  nodeId!: string;

  @ApiProperty({ description: 'Human-readable name for the storage share' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: StorageProtocol, description: 'Storage protocol (NFS or SMB)' })
  @IsEnum(StorageProtocol)
  protocol!: StorageProtocol;

  @ApiProperty({
    description: 'Server IP address or hostname',
    example: '192.168.1.100',
  })
  @IsString()
  @IsNotEmpty()
  serverAddress!: string;

  @ApiProperty({
    description: 'Share path on the server',
    example: '/mnt/user/media',
  })
  @IsString()
  @IsNotEmpty()
  sharePath!: string;

  @ApiProperty({
    description: 'Local mount point path',
    example: '/unraid-media',
  })
  @IsString()
  @IsNotEmpty()
  mountPoint!: string;

  @ApiPropertyOptional({ description: 'Mount as read-only', default: true })
  @IsBoolean()
  @IsOptional()
  readOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Custom mount options (e.g., "ro,nolock,soft")',
  })
  @IsString()
  @IsOptional()
  mountOptions?: string;

  // SMB-specific fields
  @ApiPropertyOptional({
    description: 'SMB username (required for SMB protocol)',
  })
  @ValidateIf((o) => o.protocol === StorageProtocol.SMB)
  @IsString()
  @IsNotEmpty({ message: 'SMB shares require username' })
  smbUsername?: string;

  @ApiPropertyOptional({
    description: 'SMB password (will be encrypted)',
  })
  @IsString()
  @IsOptional()
  smbPassword?: string;

  @ApiPropertyOptional({
    description: 'SMB domain',
  })
  @IsString()
  @IsOptional()
  smbDomain?: string;

  @ApiPropertyOptional({
    description: 'SMB protocol version',
    default: '3.0',
  })
  @IsString()
  @IsOptional()
  smbVersion?: string;

  // Auto-mount configuration
  @ApiPropertyOptional({
    description: 'Automatically mount on boot',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  autoMount?: boolean;

  @ApiPropertyOptional({
    description: 'Add entry to /etc/fstab for persistence',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  addToFstab?: boolean;

  @ApiPropertyOptional({
    description: 'Auto-mount when detected',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  mountOnDetection?: boolean;

  @ApiPropertyOptional({
    description: 'System-managed share (auto-created)',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  autoManaged?: boolean;

  // Owner node (if sharing from this node)
  @ApiPropertyOptional({
    description: 'ID of node that owns this share',
  })
  @IsString()
  @IsOptional()
  ownerNodeId?: string;
}
