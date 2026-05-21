import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { Notification } from './types/notification.types';

/**
 * NotificationsGateway
 *
 * WebSocket gateway for real-time notification push to connected clients.
 *
 * Features:
 * - Broadcasts notifications to all connected clients
 * - Tracks connected clients
 * - Listens to notification events and pushes them via WebSocket
 *
 * Namespace: /notifications
 * Events:
 * - notification: New notification created
 * - notification:read: Notification marked as read
 * - notification:dismissed: Notification dismissed
 */
@WebSocketGateway({
  cors: {
    origin: '*', // In production, configure this properly
    credentials: true,
  },
  namespace: 'notifications',
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private connectedClients = 0;

  afterInit(): void {
    this.logger.log('🔌 Notifications WebSocket Gateway initialized');
  }

  handleConnection(client: Socket): void {
    this.connectedClients++;
    this.logger.log(`👋 Client connected: ${client.id} (Total: ${this.connectedClients})`);
  }

  handleDisconnect(client: Socket): void {
    this.connectedClients--;
    this.logger.log(`👋 Client disconnected: ${client.id} (Total: ${this.connectedClients})`);
  }

  /**
   * Listen to notification created events and broadcast to all clients
   */
  @OnEvent('notification.created')
  handleNotificationCreated(notification: Notification): void {
    this.logger.log(
      `📡 Broadcasting notification to ${this.connectedClients} client(s): [${notification.type}] ${notification.title}`
    );
    this.server.emit('notification', notification);
  }

  /**
   * Listen to notification read events
   */
  @OnEvent('notification.read')
  handleNotificationRead(notificationId: string): void {
    this.logger.log(`📡 Broadcasting notification read: ${notificationId}`);
    this.server.emit('notification:read', { id: notificationId });
  }

  /**
   * Listen to notification dismissed events
   */
  @OnEvent('notification.dismissed')
  handleNotificationDismissed(notificationId: string): void {
    this.logger.log(`📡 Broadcasting notification dismissed: ${notificationId}`);
    this.server.emit('notification:dismissed', { id: notificationId });
  }

  /**
   * Send a notification to all connected clients
   */
  sendToAll(notification: Notification): void {
    this.server.emit('notification', notification);
  }

  /**
   * Get the number of connected clients
   */
  getConnectedClientsCount(): number {
    return this.connectedClients;
  }
}
