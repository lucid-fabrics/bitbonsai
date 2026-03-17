import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateStorageShareDto {
  @ApiPropertyOptional({ description: 'Updated share name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Updated mount options' })
  @IsString()
  @IsOptional()
  mountOptions?: string;

  @ApiPropertyOptional({ description: 'Updated read-only flag' })
  @IsBoolean()
  @IsOptional()
  readOnly?: boolean;

  @ApiPropertyOptional({ description: 'Updated auto-mount flag' })
  @IsBoolean()
  @IsOptional()
  autoMount?: boolean;

  @ApiPropertyOptional({ description: 'Updated fstab flag' })
  @IsBoolean()
  @IsOptional()
  addToFstab?: boolean;

  @ApiPropertyOptional({ description: 'Updated mount-on-detection flag' })
  @IsBoolean()
  @IsOptional()
  mountOnDetection?: boolean;

  // SMB credentials
  @ApiPropertyOptional({ description: 'Updated SMB username' })
  @IsString()
  @IsOptional()
  smbUsername?: string;

  @ApiPropertyOptional({ description: 'Updated SMB password (will be encrypted)' })
  @IsString()
  @IsOptional()
  smbPassword?: string;

  @ApiPropertyOptional({ description: 'Updated SMB domain' })
  @IsString()
  @IsOptional()
  smbDomain?: string;

  @ApiPropertyOptional({ description: 'Updated SMB version' })
  @IsString()
  @IsOptional()
  smbVersion?: string;
}
