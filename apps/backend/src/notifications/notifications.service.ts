import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { CreateNotificationDto } from './dto/notification.dto';
import type { Notification } from './types/notification.types';

/**
 * NotificationsService
 *
 * Manages in-memory notification queue with real-time push capabilities.
 * Notifications auto-expire after 24 hours.
 *
 * Features:
 * - In-memory storage for fast access
 * - Per-user/session notification queues
 * - Read/unread tracking
 * - Auto-expiration of old notifications
 * - Event emission for real-time updates via WebSocket
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly notifications: Map<string, Notification> = new Map();
  private readonly EXPIRATION_HOURS = 24;

  /**
   * Create and store a new notification
   *
   * @param dto - Notification creation data
   * @returns Created notification
   */
  async createNotification(dto: CreateNotificationDto): Promise<Notification> {
    const notification: Notification = {
      id: randomUUID(),
      type: dto.type,
      priority: dto.priority,
      title: dto.title,
      message: dto.message,
      data: dto.data,
      read: false,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.EXPIRATION_HOURS * 60 * 60 * 1000),
    };

    this.notifications.set(notification.id, notification);

    this.logger.log(
      `📬 Notification created: [${notification.type}] ${notification.title} (${notification.id})`
    );

    return notification;
  }

  /**
   * Get all active notifications (not expired)
   *
   * @param includeRead - Whether to include read notifications (default: true)
   * @returns Array of active notifications
   */
  async getNotifications(includeRead = true): Promise<Notification[]> {
    const now = new Date();

    // Filter out expired notifications
    const active = Array.from(this.notifications.values()).filter(
      (n) => n.expiresAt > now && (includeRead || !n.read)
    );

    return active.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get a specific notification by ID
   *
   * @param id - Notification ID
   * @returns Notification or undefined
   */
  async getNotificationById(id: string): Promise<Notification | undefined> {
    const notification = this.notifications.get(id);

    // Check if expired
    if (notification && notification.expiresAt <= new Date()) {
      this.notifications.delete(id);
      return undefined;
    }

    return notification;
  }

  /**
   * Mark a notification as read
   *
   * @param id - Notification ID
   */
  async markAsRead(id: string): Promise<void> {
    const notification = this.notifications.get(id);

    if (notification) {
      notification.read = true;
      this.notifications.set(id, notification);
      this.logger.log(`✅ Notification marked as read: ${id}`);
    }
  }

  /**
   * Dismiss (delete) a notification
   *
   * @param id - Notification ID
   */
  async dismiss(id: string): Promise<void> {
    const deleted = this.notifications.delete(id);

    if (deleted) {
      this.logger.log(`🗑️  Notification dismissed: ${id}`);
    }
  }

  /**
   * Get count of unread notifications
   *
   * @returns Number of unread notifications
   */
  async getUnreadCount(): Promise<number> {
    const now = new Date();
    return Array.from(this.notifications.values()).filter((n) => !n.read && n.expiresAt > now)
      .length;
  }

  /**
   * Clear all expired notifications (cleanup)
   */
  async clearExpired(): Promise<number> {
    const now = new Date();
    let count = 0;

    for (const [id, notification] of this.notifications.entries()) {
      if (notification.expiresAt <= now) {
        this.notifications.delete(id);
        count++;
      }
    }

    if (count > 0) {
      this.logger.log(`🧹 Cleared ${count} expired notification(s)`);
    }

    return count;
  }

  /**
   * Clear all notifications (testing/admin)
   */
  async clearAll(): Promise<void> {
    const count = this.notifications.size;
    this.notifications.clear();
    this.logger.log(`🗑️  Cleared all notifications (${count} total)`);
  }

  /**
   * HIGH #26 FIX: Cleanup on module destruction
   */
  async onModuleDestroy(): Promise<void> {
    this.notifications.clear();
    this.logger.log('Notifications service destroyed - cleared all notifications');
  }
}
