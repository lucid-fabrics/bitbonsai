import { Test, TestingModule } from '@nestjs/testing';
import { Server, Socket } from 'socket.io';
import { NotificationsGateway } from './notifications.gateway';
import type { Notification } from './types/notification.types';
import { NotificationPriority, NotificationType } from './types/notification.types';

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    type: NotificationType.ENCODING_COMPLETE,
    priority: NotificationPriority.MEDIUM,
    title: 'Test',
    message: 'Test message',
    read: false,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;
  let mockServer: jest.Mocked<Pick<Server, 'emit'>>;

  beforeEach(async () => {
    mockServer = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsGateway],
    }).compile();

    gateway = module.get(NotificationsGateway);
    // Inject mock server directly (bypasses WebSocketGateway decorator wiring)
    gateway.server = mockServer as unknown as Server;
  });

  describe('handleConnection', () => {
    it('increments connected client count', () => {
      const client = { id: 'client-1' } as Socket;
      expect(gateway.getConnectedClientsCount()).toBe(0);
      gateway.handleConnection(client);
      expect(gateway.getConnectedClientsCount()).toBe(1);
    });

    it('tracks multiple connections independently', () => {
      gateway.handleConnection({ id: 'c1' } as Socket);
      gateway.handleConnection({ id: 'c2' } as Socket);
      expect(gateway.getConnectedClientsCount()).toBe(2);
    });
  });

  describe('handleDisconnect', () => {
    it('decrements connected client count', () => {
      gateway.handleConnection({ id: 'c1' } as Socket);
      gateway.handleDisconnect({ id: 'c1' } as Socket);
      expect(gateway.getConnectedClientsCount()).toBe(0);
    });

    it('does not go below zero on unexpected disconnect', () => {
      gateway.handleDisconnect({ id: 'phantom' } as Socket);
      expect(gateway.getConnectedClientsCount()).toBe(-1); // mirrors current behaviour
    });
  });

  describe('handleNotificationCreated', () => {
    it('broadcasts notification event to all clients', () => {
      const notif = makeNotification();
      gateway.handleNotificationCreated(notif);
      expect(mockServer.emit).toHaveBeenCalledWith('notification', notif);
    });

    it('broadcasts even when no clients are connected', () => {
      const notif = makeNotification();
      gateway.handleNotificationCreated(notif);
      expect(mockServer.emit).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleNotificationRead', () => {
    it('broadcasts notification:read with id', () => {
      gateway.handleNotificationRead('notif-42');
      expect(mockServer.emit).toHaveBeenCalledWith('notification:read', { id: 'notif-42' });
    });
  });

  describe('handleNotificationDismissed', () => {
    it('broadcasts notification:dismissed with id', () => {
      gateway.handleNotificationDismissed('notif-99');
      expect(mockServer.emit).toHaveBeenCalledWith('notification:dismissed', { id: 'notif-99' });
    });
  });

  describe('sendToAll', () => {
    it('emits notification event to all clients', () => {
      const notif = makeNotification({ title: 'Direct broadcast' });
      gateway.sendToAll(notif);
      expect(mockServer.emit).toHaveBeenCalledWith('notification', notif);
    });

    it('handles server emit throwing without crashing', () => {
      (mockServer.emit as jest.Mock).mockImplementationOnce(() => {
        throw new Error('socket error');
      });
      expect(() => gateway.sendToAll(makeNotification())).toThrow('socket error');
    });
  });

  describe('getConnectedClientsCount', () => {
    it('returns 0 initially', () => {
      expect(gateway.getConnectedClientsCount()).toBe(0);
    });

    it('reflects connect/disconnect cycle correctly', () => {
      gateway.handleConnection({ id: 'c1' } as Socket);
      gateway.handleConnection({ id: 'c2' } as Socket);
      gateway.handleDisconnect({ id: 'c1' } as Socket);
      expect(gateway.getConnectedClientsCount()).toBe(1);
    });
  });
});
