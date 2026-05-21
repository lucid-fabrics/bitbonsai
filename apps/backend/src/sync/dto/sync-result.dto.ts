import { ApiProperty } from '@nestjs/swagger';
import { SyncStatus } from '@prisma/client';

export class SyncResultDto {
  @ApiProperty({
    description: 'Node ID that was synced',
    example: 'clx123abc456',
  })
  nodeId!: string;

  @ApiProperty({
    description: 'Sync status',
    enum: SyncStatus,
    example: SyncStatus.COMPLETED,
  })
  status!: SyncStatus;

  @ApiProperty({
    description: 'Number of policies synced',
    example: 5,
  })
  policiesSynced!: number;

  @ApiProperty({
    description: 'Number of libraries synced',
    example: 3,
  })
  librariesSynced!: number;

  @ApiProperty({
    description: 'Settings synced successfully',
    example: true,
  })
  settingsSynced!: boolean;

  @ApiProperty({
    description: 'Error message if sync failed',
    required: false,
    example: null,
  })
  error?: string;

  @ApiProperty({
    description: 'When sync was completed',
    example: '2025-11-06T00:35:31.000Z',
  })
  syncedAt!: Date;
}
