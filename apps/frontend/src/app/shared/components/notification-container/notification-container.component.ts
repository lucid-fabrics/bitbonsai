import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Notification } from '../../../core/models/notification.model';
import { NotificationService } from '../../../core/services/notification.service';
import { NotificationToastComponent } from '../notification-toast/notification-toast.component';

/**
 * NotificationContainerComponent
 *
 * Container component that manages and displays multiple notification toasts.
 * Stacks notifications vertically and limits visible count to 3.
 */
@Component({
  selector: 'app-notification-container',
  standalone: true,
  imports: [CommonModule, NotificationToastComponent],
  templateUrl: './notification-container.component.html',
  styleUrl: './notification-container.component.scss',
})
export class NotificationContainerComponent implements OnInit {
  private readonly notificationService = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly notifications = signal<Notification[]>([]);
  private readonly maxVisibleNotifications = 3;

  ngOnInit(): void {
    // Connect to WebSocket on component init
    this.notificationService.connect();

    // Subscribe to incoming notifications
    this.notificationService.notification$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((notification) => {
        this.addNotification(notification);
      });
  }

  /**
   * Add a new notification to the queue
   */
  private addNotification(notification: Notification): void {
    const current = this.notifications();

    // Add new notification to the beginning
    const updated = [notification, ...current];

    // Limit to max visible notifications
    if (updated.length > this.maxVisibleNotifications) {
      updated.splice(this.maxVisibleNotifications);
    }

    this.notifications.set(updated);
  }

  /**
   * Remove a notification by ID
   */
  removeNotification(id: string): void {
    const current = this.notifications();
    const updated = current.filter((n) => n.id !== id);
    this.notifications.set(updated);

    // Mark as read in backend
    this.notificationService.markAsRead(id).subscribe({
      error: (err) => console.error('Failed to mark notification as read:', err),
    });
  }

  /**
   * Handle notification action
   */
  handleAction(notification: Notification): void {
    console.log('Notification action:', notification);
    // Additional action handling can be added here
  }
}
