import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StorageProtocol } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TestConnectivityDto {
  @ApiProperty({
    description: 'Server IP address or hostname to test',
    example: '192.168.1.100',
  })
  @IsString()
  @IsNotEmpty()
  serverAddress!: string;

  @ApiPropertyOptional({
    enum: StorageProtocol,
    description: 'Protocol to test (if not specified, tests both NFS and SMB)',
  })
  @IsEnum(StorageProtocol)
  @IsOptional()
  protocol?: StorageProtocol;
}
