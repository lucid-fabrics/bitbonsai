import { ApiProperty } from '@nestjs/swagger';
import { NodeStatus } from '@prisma/client';

/**
 * DTO for node heartbeat updates
 */
export class HeartbeatDto {
  @ApiProperty({
    description: 'Current status of the node',
    enum: NodeStatus,
    example: NodeStatus.ONLINE,
    enumName: 'NodeStatus',
    required: false,
  })
  status?: NodeStatus;

  @ApiProperty({
    description: 'Current CPU usage percentage (0-100)',
    example: 45.5,
    minimum: 0,
    maximum: 100,
    required: false,
  })
  cpuUsage?: number;

  @ApiProperty({
    description: 'Current memory usage percentage (0-100)',
    example: 62.3,
    minimum: 0,
    maximum: 100,
    required: false,
  })
  memoryUsage?: number;

  @ApiProperty({
    description: 'Number of active encoding jobs currently running',
    example: 3,
    minimum: 0,
    required: false,
  })
  activeJobs?: number;
}
