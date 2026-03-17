import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NotificationsClient } from '../clients/notifications.client';
import type { Notification } from '../models/notification.model';
import { NotificationPriority, NotificationType } from '../models/notification.model';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let clientMock: jest.Mocked<NotificationsClient>;

  const mockNotification: Notification = {
    id: '1',
    type: NotificationType.ENCODING_COMPLETE,
    priority: NotificationPriority.MEDIUM,
    title: 'Encoding Complete',
    message: 'video.mkv finished encoding',
    read: false,
    createdAt: new Date(),
    expiresAt: new Date(),
  };

  beforeEach(() => {
    clientMock = {
      getNotifications: jest.fn(),
      getNotificationById: jest.fn(),
      markAsRead: jest.fn(),
      dismiss: jest.fn(),
      getUnreadCount: jest.fn(),
    } as unknown as jest.Mocked<NotificationsClient>;

    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        { provide: NotificationsClient, useValue: clientMock },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(NotificationService);
  });

  afterEach(() => {
    service.disconnect();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('disconnect', () => {
    it('should emit false on connected$ when disconnecting', (done) => {
      const statuses: boolean[] = [];
      service.connected$.subscribe((status) => {
        statuses.push(status);
        // BehaviorSubject emits initial false immediately
        if (statuses.length === 1) {
          expect(status).toBe(false);
          done();
        }
      });
    });

    it('should handle disconnect when no connection exists', () => {
      // Should not throw
      expect(() => service.disconnect()).not.toThrow();
    });

    it('should handle multiple disconnect calls', () => {
      service.disconnect();
      expect(() => service.disconnect()).not.toThrow();
    });
  });

  describe('connected$ observable', () => {
    it('should emit false as initial connection status', (done) => {
      service.connected$.subscribe({
        next: (status) => {
          expect(status).toBe(false);
          done();
        },
        error: done.fail,
      });
    });
  });

  describe('getNotifications', () => {
    it('should delegate to client with includeRead=true by default', () => {
      const mockNotifications = [mockNotification];
      clientMock.getNotifications.mockReturnValue(of(mockNotifications));

      service.getNotifications().subscribe((notifications) => {
        expect(notifications).toEqual(mockNotifications);
        expect(notifications).toHaveLength(1);
        expect(notifications[0].id).toBe('1');
      });

      expect(clientMock.getNotifications).toHaveBeenCalledWith(true);
    });

    it('should pass includeRead=false when specified', () => {
      clientMock.getNotifications.mockReturnValue(of([]));

      service.getNotifications(false).subscribe((notifications) => {
        expect(notifications).toEqual([]);
      });

      expect(clientMock.getNotifications).toHaveBeenCalledWith(false);
    });

    it('should return multiple notifications', () => {
      const secondNotification: Notification = {
        ...mockNotification,
        id: '2',
        type: NotificationType.ENCODING_FAILED,
        title: 'Encoding Failed',
        read: true,
      };
      clientMock.getNotifications.mockReturnValue(of([mockNotification, secondNotification]));

      service.getNotifications().subscribe((notifications) => {
        expect(notifications).toHaveLength(2);
        expect(notifications[0].type).toBe(NotificationType.ENCODING_COMPLETE);
        expect(notifications[1].type).toBe(NotificationType.ENCODING_FAILED);
        expect(notifications[1].read).toBe(true);
      });
    });
  });

  describe('markAsRead', () => {
    it('should delegate to client with correct id', () => {
      clientMock.markAsRead.mockReturnValue(of(void 0));

      service.markAsRead('notification-123').subscribe();

      expect(clientMock.markAsRead).toHaveBeenCalledWith('notification-123');
    });
  });

  describe('dismiss', () => {
    it('should delegate to client with correct id', () => {
      clientMock.dismiss.mockReturnValue(of(void 0));

      service.dismiss('notification-456').subscribe();

      expect(clientMock.dismiss).toHaveBeenCalledWith('notification-456');
    });
  });

  describe('getUnreadCount', () => {
    it('should return count from client', (done) => {
      clientMock.getUnreadCount.mockReturnValue(of({ count: 5 }));

      service.getUnreadCount().subscribe((result) => {
        expect(result.count).toBe(5);
        done();
      });
    });

    it('should return zero count', (done) => {
      clientMock.getUnreadCount.mockReturnValue(of({ count: 0 }));

      service.getUnreadCount().subscribe((result) => {
        expect(result.count).toBe(0);
        done();
      });
    });
  });
});
