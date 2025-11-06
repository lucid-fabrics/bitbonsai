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
      console.log('[Notifications] WebSocket connected');
      this.connectionStatusSubject.next(true);
    });

    this.socket.on('disconnect', () => {
      console.log('[Notifications] WebSocket disconnected');
      this.connectionStatusSubject.next(false);
    });

    this.socket.on('notification', (notification: Notification) => {
      console.log('[Notifications] Received notification:', notification);
      this.notificationSubject.next(notification);
    });

    this.socket.on('notification:read', (data: { id: string }) => {
      console.log('[Notifications] Notification marked as read:', data.id);
    });

    this.socket.on('notification:dismissed', (data: { id: string }) => {
      console.log('[Notifications] Notification dismissed:', data.id);
    });

    this.socket.on('error', (error: Error) => {
      console.error('[Notifications] WebSocket error:', error);
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

    // For development, use port 3100 (backend port)
    const wsPort = port === '4200' ? '3100' : port;

    return `${protocol}//${host}:${wsPort}/notifications`;
  }
}
