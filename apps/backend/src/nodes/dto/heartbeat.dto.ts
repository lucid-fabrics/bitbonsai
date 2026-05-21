import { ApiProperty } from '@nestjs/swagger';
import { NodeStatus } from '@prisma/client';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

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
  @IsOptional()
  @Min(0)
  @Max(100)
  cpuUsage?: number;

  @ApiProperty({
    description: 'Current memory usage percentage (0-100)',
    example: 62.3,
    minimum: 0,
    maximum: 100,
    required: false,
  })
  @IsOptional()
  @Min(0)
  @Max(100)
  memoryUsage?: number;

  @ApiProperty({
    description: 'Number of active encoding jobs currently running',
    example: 3,
    minimum: 0,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  activeJobs?: number;

  @ApiProperty({
    description: 'IP address of the node sending the heartbeat (for LINKED nodes)',
    example: '192.168.1.170',
    required: false,
  })
  @IsOptional()
  @Matches(
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
    {
      message: 'IP address must be a valid IPv4 address',
    }
  )
  ipAddress?: string;
}
