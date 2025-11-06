import { Body, Controller, Delete, Get, Logger, Param, Patch, Post, Query } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateNotificationDto, NotificationDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * NotificationsController
 *
 * REST API endpoints for notification management
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('api/v1/notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

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
  @ApiResponse({
    status: 200,
    description: 'List of notifications',
    type: [NotificationDto],
  })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getNotifications(@Query('includeRead') includeRead = 'true'): Promise<NotificationDto[]> {
    const include = includeRead === 'true';
    return this.notificationsService.getNotifications(include);
  }

  /**
   * Get notification by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get notification by ID',
    description: 'Retrieves a specific notification by its ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification found',
    type: NotificationDto,
  })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
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
  @ApiResponse({
    status: 201,
    description: 'Notification created',
    type: NotificationDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
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
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
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
  @ApiResponse({ status: 200, description: 'Notification dismissed' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async dismiss(@Param('id') id: string): Promise<void> {
    await this.notificationsService.dismiss(id);

    // Emit event for WebSocket broadcast
    this.eventEmitter.emit('notification.dismissed', id);
  }

  /**
   * Get unread notification count
   */
  @Get('count/unread')
  @ApiOperation({
    summary: 'Get unread notification count',
    description: 'Returns the number of unread notifications',
  })
  @ApiResponse({
    status: 200,
    description: 'Unread notification count',
    schema: { type: 'object', properties: { count: { type: 'number' } } },
  })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getUnreadCount(): Promise<{ count: number }> {
    const count = await this.notificationsService.getUnreadCount();
    return { count };
  }
}
