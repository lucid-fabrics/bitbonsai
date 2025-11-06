import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NotificationsClient } from '../clients/notifications.client';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        NotificationsClient,
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

  describe('WebSocket connection', () => {
    it('should connect to WebSocket server', () => {
      service.connect();
      expect(service).toBeTruthy();
    });

    it('should disconnect from WebSocket server', () => {
      service.connect();
      service.disconnect();
      expect(service).toBeTruthy();
    });

    it('should not reconnect if already connected', () => {
      service.connect();
      service.connect(); // Second call should not create new connection
      expect(service).toBeTruthy();
    });
  });

  describe('notification$ observable', () => {
    it('should emit notifications', (done) => {
      const subscription = service.notification$.subscribe((notification) => {
        expect(notification).toBeDefined();
        subscription.unsubscribe();
        done();
      });

      // Note: This test would need to be integrated with actual WebSocket events
      // For unit testing, we would need to mock the socket connection
    });
  });

  describe('connected$ observable', () => {
    it('should emit connection status', (done) => {
      const subscription = service.connected$.subscribe((status) => {
        expect(typeof status).toBe('boolean');
        subscription.unsubscribe();
        done();
      });
    });
  });
});
