import { ApiProperty } from '@nestjs/swagger';

export class StorageInfoDto {
  @ApiProperty({
    description: 'Used storage in GB',
    example: 15.3,
  })
  usedGb!: number;

  @ApiProperty({
    description: 'Total storage in GB',
    example: 100.0,
  })
  totalGb!: number;

  @ApiProperty({
    description: 'Storage usage percentage',
    example: 15.3,
  })
  usagePercent!: number;
}
