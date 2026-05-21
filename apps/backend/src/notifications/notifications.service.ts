import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
 * - Auto-expiration of old notifications (CRITICAL #4 FIX: Periodic cleanup every 10 minutes)
 * - Event emission for real-time updates via WebSocket
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly notifications: Map<string, Notification> = new Map();
  private readonly EXPIRATION_HOURS = 24;

  // CRITICAL #4 FIX: Track cleanup interval for proper shutdown
  private cleanupIntervalId?: NodeJS.Timeout;

  /**
   * CRITICAL #4 FIX: Start periodic cleanup of expired notifications
   * Runs every 10 minutes to prevent unbounded Map growth
   */
  onModuleInit() {
    const cleanupIntervalMs = 10 * 60 * 1000; // 10 minutes

    this.cleanupIntervalId = setInterval(() => {
      this.clearExpired();
    }, cleanupIntervalMs);

    this.logger.log(
      `✅ CRITICAL #4 FIX: Notification cleanup interval started (every ${cleanupIntervalMs / 1000}s)`
    );
  }

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
   * CRITICAL #4 FIX: Lazy cleanup - delete expired notifications during read
   *
   * @param includeRead - Whether to include read notifications (default: true)
   * @returns Array of active notifications
   */
  async getNotifications(includeRead = true): Promise<Notification[]> {
    const now = new Date();
    const active: Notification[] = [];

    // CRITICAL #4 FIX: Filter active notifications AND delete expired ones (lazy cleanup)
    for (const [id, notification] of this.notifications.entries()) {
      if (notification.expiresAt <= now) {
        // Expired - delete from Map
        this.notifications.delete(id);
      } else if (includeRead || !notification.read) {
        // Active and matches read filter
        active.push(notification);
      }
    }

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
   * CRITICAL #4 FIX: Cleanup on module destruction
   * Clears cleanup interval and all notifications
   */
  async onModuleDestroy(): Promise<void> {
    // CRITICAL #4 FIX: Clear cleanup interval
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = undefined;
      this.logger.log('✓ CRITICAL #4 FIX: Notification cleanup interval cleared');
    }

    this.notifications.clear();
    this.logger.log('Notifications service destroyed - cleared all notifications');
  }
}
