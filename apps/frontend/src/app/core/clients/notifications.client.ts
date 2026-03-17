import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { Notification } from '../models/notification.model';

/**
 * NotificationsClient
 *
 * HTTP client for notifications REST API
 */
@Injectable({
  providedIn: 'root',
})
export class NotificationsClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/notifications';

  /**
   * Get all notifications
   *
   * @param includeRead - Include read notifications (default: true)
   */
  getNotifications(includeRead = true): Observable<Notification[]> {
    return this.http.get<Notification[]>(this.apiUrl, {
      params: { includeRead: includeRead.toString() },
    });
  }

  /**
   * Get a specific notification by ID
   *
   * @param id - Notification ID
   */
  getNotificationById(id: string): Observable<Notification> {
    return this.http.get<Notification>(`${this.apiUrl}/${id}`);
  }

  /**
   * Mark a notification as read
   *
   * @param id - Notification ID
   */
  markAsRead(id: string): Observable<void> {
    return this.http.patch<void>(`${this.apiUrl}/${id}/read`, {});
  }

  /**
   * Dismiss (delete) a notification
   *
   * @param id - Notification ID
   */
  dismiss(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  /**
   * Get unread notification count
   */
  getUnreadCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.apiUrl}/count/unread`);
  }
}
