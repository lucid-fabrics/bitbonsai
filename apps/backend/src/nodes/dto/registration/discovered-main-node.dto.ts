import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for a discovered MAIN node
 */
export class DiscoveredMainNodeDto {
  @ApiProperty({
    description: 'MAIN node unique identifier',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  nodeId!: string;

  @ApiProperty({
    description: 'MAIN node name',
    example: 'Main Encoding Hub',
  })
  nodeName!: string;

  @ApiProperty({
    description: 'MAIN node IP address',
    example: '192.168.1.50',
  })
  ipAddress!: string;

  @ApiProperty({
    description: 'MAIN node port',
    example: 3000,
  })
  port!: number;

  @ApiProperty({
    description: 'MAIN node API URL',
    example: 'http://192.168.1.50:3000/api/v1',
  })
  apiUrl!: string;

  @ApiProperty({
    description: 'MAIN node version',
    example: '1.0.0',
  })
  version!: string;

  @ApiProperty({
    description: 'Whether this node was successfully discovered',
    example: true,
  })
  discovered!: boolean;
}
