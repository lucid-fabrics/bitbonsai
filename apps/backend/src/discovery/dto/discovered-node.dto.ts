import { ApiProperty } from '@nestjs/swagger';
import { HardwareCapabilitiesDto } from '../../system/dto/hardware-capabilities.dto';

/**
 * DiscoveredNodeDto
 *
 * Represents a MAIN node discovered via mDNS on the local network.
 * Used by LINKED nodes to display available pairing targets.
 */
export class DiscoveredNodeDto {
  @ApiProperty({
    description: 'Node unique identifier',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  nodeId!: string;

  @ApiProperty({
    description: 'Node display name',
    example: 'BitBonsai Main',
  })
  name!: string;

  @ApiProperty({
    description: 'BitBonsai version',
    example: '1.0.0',
  })
  version!: string;

  @ApiProperty({
    description: 'API port number',
    example: 3100,
  })
  apiPort!: number;

  @ApiProperty({
    description: 'IP address of the node',
    example: '192.168.1.100',
  })
  ipAddress!: string;

  @ApiProperty({
    description: 'Hostname of the node',
    example: 'bitbonsai.local',
  })
  hostname!: string;

  @ApiProperty({
    description: 'When this node was discovered',
    example: '2025-01-05T12:00:00Z',
  })
  discoveredAt!: Date;

  @ApiProperty({
    description: 'Hardware capabilities of the node',
    type: HardwareCapabilitiesDto,
    required: false,
  })
  hardware?: HardwareCapabilitiesDto;
}
