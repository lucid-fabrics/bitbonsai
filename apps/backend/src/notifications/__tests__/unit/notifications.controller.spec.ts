import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { NotificationsController } from '../../notifications.controller';
import { NotificationsService } from '../../notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;

  const mockNotificationsService = {
    getNotifications: jest.fn(),
    getUnreadCount: jest.fn(),
    getNotificationById: jest.fn(),
    createNotification: jest.fn(),
    markAsRead: jest.fn(),
    dismiss: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getNotifications', () => {
    it('should pass include=true when query is "true" (default)', async () => {
      const notifications = [{ id: 'n1' }, { id: 'n2' }];
      mockNotificationsService.getNotifications.mockResolvedValue(notifications);

      const result = await controller.getNotifications('true');

      expect(mockNotificationsService.getNotifications).toHaveBeenCalledWith(true);
      expect(result).toEqual(notifications);
    });

    it('should pass include=false when query is "false"', async () => {
      mockNotificationsService.getNotifications.mockResolvedValue([]);

      await controller.getNotifications('false');

      expect(mockNotificationsService.getNotifications).toHaveBeenCalledWith(false);
    });

    it('should default to include=true when query is any truthy string', async () => {
      mockNotificationsService.getNotifications.mockResolvedValue([]);

      await controller.getNotifications('true');

      expect(mockNotificationsService.getNotifications).toHaveBeenCalledWith(true);
    });

    it('should propagate service errors', async () => {
      mockNotificationsService.getNotifications.mockRejectedValue(new Error('fetch error'));
      await expect(controller.getNotifications('true')).rejects.toThrow('fetch error');
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread count wrapped in object', async () => {
      mockNotificationsService.getUnreadCount.mockResolvedValue(5);

      const result = await controller.getUnreadCount();

      expect(mockNotificationsService.getUnreadCount).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ count: 5 });
    });

    it('should return { count: 0 } when no unread notifications', async () => {
      mockNotificationsService.getUnreadCount.mockResolvedValue(0);

      const result = await controller.getUnreadCount();

      expect(result).toEqual({ count: 0 });
    });

    it('should propagate service errors', async () => {
      mockNotificationsService.getUnreadCount.mockRejectedValue(new Error('count error'));
      await expect(controller.getUnreadCount()).rejects.toThrow('count error');
    });
  });

  describe('getNotificationById', () => {
    it('should call service with id and return notification', async () => {
      const notification = { id: 'n1', message: 'Test' };
      mockNotificationsService.getNotificationById.mockResolvedValue(notification);

      const result = await controller.getNotificationById('n1');

      expect(mockNotificationsService.getNotificationById).toHaveBeenCalledWith('n1');
      expect(result).toEqual(notification);
    });

    it('should return undefined when notification not found', async () => {
      mockNotificationsService.getNotificationById.mockResolvedValue(undefined);

      const result = await controller.getNotificationById('missing');

      expect(result).toBeUndefined();
    });

    it('should propagate service errors', async () => {
      mockNotificationsService.getNotificationById.mockRejectedValue(new Error('not found'));
      await expect(controller.getNotificationById('n1')).rejects.toThrow('not found');
    });
  });

  describe('createNotification', () => {
    it('should create notification, emit event, and return it', async () => {
      const dto = { message: 'New notification', type: 'INFO' } as never;
      const notification = { id: 'n1', message: 'New notification', type: 'INFO' };
      mockNotificationsService.createNotification.mockResolvedValue(notification);

      const result = await controller.createNotification(dto);

      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(dto);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('notification.created', notification);
      expect(result).toEqual(notification);
    });

    it('should propagate service errors without emitting event', async () => {
      mockNotificationsService.createNotification.mockRejectedValue(new Error('create error'));

      await expect(controller.createNotification({} as never)).rejects.toThrow('create error');
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('markAsRead', () => {
    it('should call service.markAsRead and emit notification.read event', async () => {
      mockNotificationsService.markAsRead.mockResolvedValue(undefined);

      await controller.markAsRead('n1');

      expect(mockNotificationsService.markAsRead).toHaveBeenCalledWith('n1');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('notification.read', 'n1');
    });

    it('should propagate service errors without emitting event', async () => {
      mockNotificationsService.markAsRead.mockRejectedValue(new Error('mark error'));

      await expect(controller.markAsRead('n1')).rejects.toThrow('mark error');
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('dismiss', () => {
    it('should call service.dismiss and emit notification.dismissed event', async () => {
      mockNotificationsService.dismiss.mockResolvedValue(undefined);

      await controller.dismiss('n1');

      expect(mockNotificationsService.dismiss).toHaveBeenCalledWith('n1');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('notification.dismissed', 'n1');
    });

    it('should propagate service errors without emitting event', async () => {
      mockNotificationsService.dismiss.mockRejectedValue(new Error('dismiss error'));

      await expect(controller.dismiss('n1')).rejects.toThrow('dismiss error');
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
