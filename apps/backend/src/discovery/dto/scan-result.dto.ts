import { ApiProperty } from '@nestjs/swagger';
import { DiscoveredNodeDto } from './discovered-node.dto';

/**
 * Scan Result DTO
 *
 * Response from network scan containing discovered nodes and scan duration.
 */
export class ScanResultDto {
  @ApiProperty({
    description: 'List of discovered MAIN nodes',
    type: [DiscoveredNodeDto],
  })
  nodes!: DiscoveredNodeDto[];

  @ApiProperty({
    description: 'Scan duration in milliseconds',
    example: 5000,
  })
  scanDurationMs!: number;
}
