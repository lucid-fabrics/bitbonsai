import { ApiProperty } from '@nestjs/swagger';
import { AccelerationType, ContainerType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, Length } from 'class-validator';

/**
 * DTO for creating a registration request from a CHILD node
 * Now includes system information collected by the CHILD node
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

  // System Information (collected by CHILD node)
  @ApiProperty({
    description: 'IP address of the child node',
    example: '192.168.1.50',
  })
  @IsNotEmpty()
  @IsString()
  ipAddress!: string;

  @ApiProperty({
    description: 'Hostname of the child node',
    example: 'encoding-server-1',
  })
  @IsNotEmpty()
  @IsString()
  hostname!: string;

  @ApiProperty({
    description: 'MAC address of the child node',
    example: 'aa:bb:cc:dd:ee:ff',
    required: false,
  })
  @IsOptional()
  @IsString()
  macAddress?: string | null;

  @ApiProperty({
    description: 'Subnet of the child node',
    example: '192.168.1.0/24',
    required: false,
  })
  @IsOptional()
  @IsString()
  subnet?: string | null;

  @ApiProperty({
    description: 'Container type of the child node',
    enum: ContainerType,
    example: ContainerType.DOCKER,
  })
  @IsNotEmpty()
  @IsEnum(ContainerType)
  containerType!: ContainerType;

  @ApiProperty({
    description: 'Hardware specifications of the child node',
    example: {
      cpuCores: 8,
      cpuModel: 'Intel Core i7-9700K',
      ramGb: 32,
      diskGb: 500,
      gpuModel: 'NVIDIA GeForce RTX 3080',
    },
  })
  @IsNotEmpty()
  @IsObject()
  hardwareSpecs!: {
    cpuCores: number;
    cpuModel: string;
    ramGb: number;
    diskGb: number;
    gpuModel: string | null;
  };

  @ApiProperty({
    description: 'Acceleration type of the child node',
    enum: AccelerationType,
    example: AccelerationType.NVIDIA,
  })
  @IsNotEmpty()
  @IsEnum(AccelerationType)
  acceleration!: AccelerationType;

  @ApiProperty({
    description: 'SSH public key for passwordless authentication (for file transfers)',
    example: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC... bitbonsai-cluster-node',
    required: false,
  })
  @IsOptional()
  @IsString()
  sshPublicKey?: string;
}
