import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from '../notifications.service';
import { NotificationPriority, NotificationType } from '../types/notification.types';

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsService],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(async () => {
    await service.clearAll();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createNotification', () => {
    it('should create a notification with all required fields', async () => {
      const dto = {
        type: NotificationType.NODE_DISCOVERED,
        priority: NotificationPriority.HIGH,
        title: 'Test Notification',
        message: 'This is a test',
        data: { testKey: 'testValue' },
      };

      const notification = await service.createNotification(dto);

      expect(notification).toBeDefined();
      expect(notification.id).toBeDefined();
      expect(notification.type).toBe(dto.type);
      expect(notification.priority).toBe(dto.priority);
      expect(notification.title).toBe(dto.title);
      expect(notification.message).toBe(dto.message);
      expect(notification.data).toEqual(dto.data);
      expect(notification.read).toBe(false);
      expect(notification.createdAt).toBeInstanceOf(Date);
      expect(notification.expiresAt).toBeInstanceOf(Date);
    });

    it('should set expiration date 24 hours in the future', async () => {
      const dto = {
        type: NotificationType.NODE_DISCOVERED,
        priority: NotificationPriority.HIGH,
        title: 'Test Notification',
        message: 'This is a test',
      };

      const notification = await service.createNotification(dto);

      const now = new Date();
      const expectedExpiration = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const timeDiff = Math.abs(notification.expiresAt.getTime() - expectedExpiration.getTime());

      // Allow 1 second difference due to processing time
      expect(timeDiff).toBeLessThan(1000);
    });
  });

  describe('getNotifications', () => {
    it('should return empty array when no notifications exist', async () => {
      const notifications = await service.getNotifications();
      expect(notifications).toEqual([]);
    });

    it('should return all notifications', async () => {
      await service.createNotification({
        type: NotificationType.NODE_DISCOVERED,
        priority: NotificationPriority.HIGH,
        title: 'Notification 1',
        message: 'Message 1',
      });

      await service.createNotification({
        type: NotificationType.ENCODING_COMPLETE,
        priority: NotificationPriority.MEDIUM,
        title: 'Notification 2',
        message: 'Message 2',
      });

      const notifications = await service.getNotifications();
      expect(notifications).toHaveLength(2);
    });

    it('should filter out read notifications when includeRead is false', async () => {
      const notification1 = await service.createNotification({
        type: NotificationType.NODE_DISCOVERED,
        priority: NotificationPriority.HIGH,
        title: 'Notification 1',
        message: 'Message 1',
      });

      await service.createNotification({
        type: NotificationType.ENCODING_COMPLETE,
        priority: NotificationPriority.MEDIUM,
        title: 'Notification 2',
        message: 'Message 2',
      });

      await service.markAsRead(notification1.id);

      const notifications = await service.getNotifications(false);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe('Notification 2');
    });

    it('should sort notifications by createdAt descending', async () => {
      await service.createNotification({
        type: NotificationType.NODE_DISCOVERED,
        priority: NotificationPriority.HIGH,
        title: 'First',
        message: 'Message 1',
      });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await service.createNotification({
        type: NotificationType.ENCODING_COMPLETE,
        priority: NotificationPriority.MEDIUM,
        title: 'Second',
        message: 'Message 2',
      });

      const notifications = await service.getNotifications();
      expect(notifications[0].title).toBe('Second');
      expect(notifications[1].title).toBe('First');
    });
  });

  describe('getNotificationById', () => {
    it('should return notification by ID', async () => {
      const created = await service.createNotification({
        type: NotificationType.NODE_DISCOVERED,
        priority: NotificationPriority.HIGH,
        title: 'Test',
        message: 'Test message',
      });

      const found = await service.getNotificationById(created.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it('should return undefined for non-existent ID', async () => {
      const found = await service.getNotificationById('non-existent-id');
      expect(found).toBeUndefined();
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const notification = await service.createNotification({
        type: NotificationType.NODE_DISCOVERED,
        priority: NotificationPriority.HIGH,
        title: 'Test',
        message: 'Test message',
      });

      expect(notification.read).toBe(false);

      await service.markAsRead(notification.id);

      const updated = await service.getNotificationById(notification.id);
      expect(updated?.read).toBe(true);
    });

    it('should not throw error for non-existent notification', async () => {
      await expect(service.markAsRead('non-existent-id')).resolves.not.toThrow();
    });
  });

  describe('dismiss', () => {
    it('should delete notification', async () => {
      const notification = await service.createNotification({
        type: NotificationType.NODE_DISCOVERED,
        priority: NotificationPriority.HIGH,
        title: 'Test',
        message: 'Test message',
      });

      await service.dismiss(notification.id);

      const found = await service.getNotificationById(notification.id);
      expect(found).toBeUndefined();
    });

    it('should not throw error for non-existent notification', async () => {
      await expect(service.dismiss('non-existent-id')).resolves.not.toThrow();
    });
  });

  describe('getUnreadCount', () => {
    it('should return 0 when no notifications exist', async () => {
      const count = await service.getUnreadCount();
      expect(count).toBe(0);
    });

    it('should return count of unread notifications', async () => {
      const notification1 = await service.createNotification({
        type: NotificationType.NODE_DISCOVERED,
        priority: NotificationPriority.HIGH,
        title: 'Notification 1',
        message: 'Message 1',
      });

      await service.createNotification({
        type: NotificationType.ENCODING_COMPLETE,
        priority: NotificationPriority.MEDIUM,
        title: 'Notification 2',
        message: 'Message 2',
      });

      await service.markAsRead(notification1.id);

      const count = await service.getUnreadCount();
      expect(count).toBe(1);
    });
  });

  describe('clearExpired', () => {
    it('should clear expired notifications', async () => {
      const notification = await service.createNotification({
        type: NotificationType.NODE_DISCOVERED,
        priority: NotificationPriority.HIGH,
        title: 'Test',
        message: 'Test message',
      });

      // Manually set expiration to past
      const found = await service.getNotificationById(notification.id);
      if (found) {
        found.expiresAt = new Date(Date.now() - 1000);
      }

      const count = await service.clearExpired();
      expect(count).toBeGreaterThan(0);

      const notifications = await service.getNotifications();
      expect(notifications).toHaveLength(0);
    });
  });

  describe('clearAll', () => {
    it('should clear all notifications', async () => {
      await service.createNotification({
        type: NotificationType.NODE_DISCOVERED,
        priority: NotificationPriority.HIGH,
        title: 'Notification 1',
        message: 'Message 1',
      });

      await service.createNotification({
        type: NotificationType.ENCODING_COMPLETE,
        priority: NotificationPriority.MEDIUM,
        title: 'Notification 2',
        message: 'Message 2',
      });

      await service.clearAll();

      const notifications = await service.getNotifications();
      expect(notifications).toHaveLength(0);
    });
  });
});
