import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { NotificationPriority, NotificationType } from '../types/notification.types';

export class NotificationDto {
  @ApiProperty({
    description: 'Unique notification identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  id!: string;

  @ApiProperty({
    description: 'Type of notification',
    enum: NotificationType,
    example: NotificationType.NODE_DISCOVERED,
  })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty({
    description: 'Priority level of the notification',
    enum: NotificationPriority,
    example: NotificationPriority.HIGH,
  })
  @IsEnum(NotificationPriority)
  priority!: NotificationPriority;

  @ApiProperty({
    description: 'Notification title',
    example: 'New Node Discovered',
  })
  @IsString()
  title!: string;

  @ApiProperty({
    description: 'Notification message',
    example: 'Node "Worker-01" is ready to join your network',
  })
  @IsString()
  message!: string;

  @ApiProperty({
    description: 'Additional data specific to the notification type',
    required: false,
    example: { nodeId: 'node-123', nodeName: 'Worker-01' },
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, unknown>;

  @ApiProperty({
    description: 'Whether the notification has been read',
    example: false,
  })
  @IsBoolean()
  read!: boolean;

  @ApiProperty({
    description: 'When the notification was created',
    example: '2025-11-05T10:30:00Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'When the notification expires',
    example: '2025-11-06T10:30:00Z',
  })
  expiresAt!: Date;
}

export class CreateNotificationDto {
  @ApiProperty({
    description: 'Type of notification',
    enum: NotificationType,
    example: NotificationType.NODE_DISCOVERED,
  })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty({
    description: 'Priority level of the notification',
    enum: NotificationPriority,
    example: NotificationPriority.HIGH,
  })
  @IsEnum(NotificationPriority)
  priority!: NotificationPriority;

  @ApiProperty({
    description: 'Notification title',
    example: 'New Node Discovered',
  })
  @IsString()
  title!: string;

  @ApiProperty({
    description: 'Notification message',
    example: 'Node "Worker-01" is ready to join your network',
  })
  @IsString()
  message!: string;

  @ApiProperty({
    description: 'Additional data specific to the notification type',
    required: false,
    example: { nodeId: 'node-123', nodeName: 'Worker-01' },
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, unknown>;
}

export class MarkAsReadDto {
  @ApiProperty({
    description: 'Notification ID to mark as read',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  id!: string;
}
