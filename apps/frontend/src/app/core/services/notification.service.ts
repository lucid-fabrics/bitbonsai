import { Injectable, inject, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { NotificationsClient } from '../clients/notifications.client';
import type { Notification } from '../models/notification.model';

/**
 * NotificationService
 *
 * Manages real-time notifications via WebSocket and HTTP API.
 *
 * Features:
 * - WebSocket connection for real-time notifications
 * - Observable stream of incoming notifications
 * - HTTP API for CRUD operations
 * - Auto-reconnection on disconnect
 */
@Injectable({
  providedIn: 'root',
})
export class NotificationService implements OnDestroy {
  private readonly client = inject(NotificationsClient);

  private socket: Socket | null = null;
  private readonly notificationSubject = new Subject<Notification>();
  private readonly connectionStatusSubject = new BehaviorSubject<boolean>(false);

  // Observable stream of incoming notifications
  readonly notification$ = this.notificationSubject.asObservable();

  // Observable stream of connection status
  readonly connected$ = this.connectionStatusSubject.asObservable();

  /**
   * Connect to the notifications WebSocket server
   */
  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    const wsUrl = this.getWebSocketUrl();

    this.socket = io(wsUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
    });

    this.socket.on('connect', () => {
      this.connectionStatusSubject.next(true);
    });

    this.socket.on('disconnect', () => {
      this.connectionStatusSubject.next(false);
    });

    this.socket.on('notification', (notification: Notification) => {
      this.notificationSubject.next(notification);
    });

    this.socket.on('notification:read', () => {
      // State updated via observable
    });

    this.socket.on('notification:dismissed', () => {
      // State updated via observable
    });

    this.socket.on('error', () => {
      // Errors handled via connection status
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connectionStatusSubject.next(false);
    }
  }

  /**
   * Get all notifications via HTTP
   */
  getNotifications(includeRead = true): Observable<Notification[]> {
    return this.client.getNotifications(includeRead);
  }

  /**
   * Mark notification as read
   */
  markAsRead(id: string): Observable<void> {
    return this.client.markAsRead(id);
  }

  /**
   * Dismiss notification
   */
  dismiss(id: string): Observable<void> {
    return this.client.dismiss(id);
  }

  /**
   * Get unread notification count
   */
  getUnreadCount(): Observable<{ count: number }> {
    return this.client.getUnreadCount();
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  /**
   * Get WebSocket URL based on current location
   */
  private getWebSocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port || (protocol === 'wss:' ? '443' : '80');

    // Map frontend ports to backend ports
    // 4200 = local dev frontend -> 3100 backend
    // 4210 = Unraid frontend -> 3100 backend
    const frontendToBackendPorts: Record<string, string> = {
      '4200': '3100',
      '4210': '3100',
    };
    const wsPort = frontendToBackendPorts[port] || port;

    return `${protocol}//${host}:${wsPort}/notifications`;
  }
}
