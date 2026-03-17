import { ApiProperty } from '@nestjs/swagger';
import { SyncStatus } from '@prisma/client';

export class SyncStatusDto {
  @ApiProperty({
    description: 'Node ID',
    example: 'clx123abc456',
  })
  nodeId!: string;

  @ApiProperty({
    description: 'Current sync status',
    enum: SyncStatus,
    example: SyncStatus.COMPLETED,
  })
  status!: SyncStatus;

  @ApiProperty({
    description: 'When last synced',
    required: false,
    example: '2025-11-06T00:35:31.000Z',
  })
  lastSyncedAt?: Date;

  @ApiProperty({
    description: 'Number of retry attempts',
    example: 0,
  })
  retryCount!: number;

  @ApiProperty({
    description: 'Error message if sync failed',
    required: false,
    example: null,
  })
  error?: string;
}
