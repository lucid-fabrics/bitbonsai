import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CreateNotificationDto, NotificationDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * NotificationsController
 *
 * REST API endpoints for notification management
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /**
   * Get all notifications
   */
  @Get()
  @ApiOperation({
    summary: 'Get all notifications',
    description: 'Retrieves all active notifications (not expired)',
  })
  @ApiQuery({
    name: 'includeRead',
    required: false,
    type: Boolean,
    description: 'Include read notifications (default: true)',
  })
  @ApiOkResponse({ description: 'Notifications retrieved', type: [NotificationDto] })
  @ApiInternalServerErrorResponse({ description: 'Failed to retrieve notifications' })
  async getNotifications(@Query('includeRead') includeRead = 'true'): Promise<NotificationDto[]> {
    const include = includeRead === 'true';
    return this.notificationsService.getNotifications(include);
  }

  /**
   * Get unread notification count
   */
  @Get('count/unread')
  @ApiOperation({
    summary: 'Get unread notification count',
    description: 'Returns the number of unread notifications',
  })
  @ApiOkResponse({
    description: 'Unread count retrieved',
    schema: { type: 'object', properties: { count: { type: 'number' } } },
  })
  @ApiInternalServerErrorResponse({ description: 'Failed to count notifications' })
  async getUnreadCount(): Promise<{ count: number }> {
    const count = await this.notificationsService.getUnreadCount();
    return { count };
  }

  /**
   * Get notification by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get notification by ID',
    description: 'Retrieves a specific notification by its ID',
  })
  @ApiOkResponse({ description: 'Notification found', type: NotificationDto })
  @ApiNotFoundResponse({ description: 'Notification not found' })
  @ApiInternalServerErrorResponse({ description: 'Failed to retrieve notification' })
  async getNotificationById(@Param('id') id: string): Promise<NotificationDto | undefined> {
    return this.notificationsService.getNotificationById(id);
  }

  /**
   * Create a new notification (admin/system use)
   */
  @Post()
  @ApiOperation({
    summary: 'Create a new notification',
    description: 'Creates a new notification and broadcasts it to connected clients',
  })
  @ApiCreatedResponse({ description: 'Notification created', type: NotificationDto })
  @ApiBadRequestResponse({ description: 'Invalid request' })
  @ApiInternalServerErrorResponse({ description: 'Failed to create notification' })
  async createNotification(@Body() dto: CreateNotificationDto): Promise<NotificationDto> {
    const notification = await this.notificationsService.createNotification(dto);

    // Emit event for WebSocket broadcast
    this.eventEmitter.emit('notification.created', notification);

    return notification;
  }

  /**
   * Mark notification as read
   */
  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark notification as read',
    description: 'Marks a notification as read',
  })
  @ApiOkResponse({ description: 'Notification marked as read' })
  @ApiNotFoundResponse({ description: 'Notification not found' })
  @ApiInternalServerErrorResponse({ description: 'Failed to mark as read' })
  async markAsRead(@Param('id') id: string): Promise<void> {
    await this.notificationsService.markAsRead(id);

    // Emit event for WebSocket broadcast
    this.eventEmitter.emit('notification.read', id);
  }

  /**
   * Dismiss notification
   */
  @Delete(':id')
  @ApiOperation({
    summary: 'Dismiss notification',
    description: 'Deletes a notification',
  })
  @ApiOkResponse({ description: 'Notification dismissed' })
  @ApiNotFoundResponse({ description: 'Notification not found' })
  @ApiInternalServerErrorResponse({ description: 'Failed to dismiss notification' })
  async dismiss(@Param('id') id: string): Promise<void> {
    await this.notificationsService.dismiss(id);

    // Emit event for WebSocket broadcast
    this.eventEmitter.emit('notification.dismissed', id);
  }
}
