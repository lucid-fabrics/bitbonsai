import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  type OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faBell,
  faBellSlash,
  faBoxArchive,
  faCheckCircle,
  faCircleNotch,
  faExclamationTriangle,
  faExpand,
  faServer,
  faTimes,
  faTimesCircle,
} from '@fortawesome/pro-solid-svg-icons';
import type { Notification } from '../../../core/models/notification.model';
import { NotificationType } from '../../../core/models/notification.model';
import { NotificationService } from '../../../core/services/notification.service';
import { NotificationDetailModalComponent } from './notification-detail-modal.component';

@Component({
  selector: 'app-notification-panel',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule],
  templateUrl: './notification-panel.component.html',
  styleUrls: ['./notification-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationPanelComponent implements OnInit {
  private readonly notificationService = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(DialogRef);
  private readonly dialog = inject(Dialog);

  // Expose enum to template
  readonly NotificationType = NotificationType;

  // Font Awesome icons
  readonly icons = {
    bell: faBell,
    bellSlash: faBellSlash,
    close: faTimes,
    loading: faCircleNotch,
    server: faServer,
    checkCircle: faCheckCircle,
    timesCircle: faTimesCircle,
    exclamationTriangle: faExclamationTriangle,
    archive: faBoxArchive,
    expand: faExpand,
  };

  activeTab: 'active' | 'archived' = 'active';
  notifications: Notification[] = [];
  archivedNotifications: Notification[] = [];
  isLoading = false;

  ngOnInit(): void {
    this.loadNotifications();
  }

  /**
   * Switch between tabs
   */
  switchTab(tab: 'active' | 'archived'): void {
    this.activeTab = tab;
    if (tab === 'archived') {
      this.loadArchivedNotifications();
    }
  }

  /**
   * Get currently displayed notifications based on active tab
   */
  get displayedNotifications(): Notification[] {
    return this.activeTab === 'active' ? this.notifications : this.archivedNotifications;
  }

  /**
   * Load all active notifications (both read and unread)
   */
  private loadNotifications(): void {
    this.isLoading = true;
    this.cdr.markForCheck();

    this.notificationService
      .getNotifications(true) // Include both read and unread
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (notifications) => {
          this.notifications = notifications;
          this.isLoading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.isLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Load archived notifications
   */
  private loadArchivedNotifications(): void {
    // For now, archived notifications are stored locally
    // In the future, this could be an API call
    this.cdr.markForCheck();
  }

  /**
   * Expand notification to show full details in modal
   */
  onExpandNotification(event: Event, notification: Notification): void {
    event.stopPropagation();

    // Mark as read
    if (!notification.read) {
      this.notificationService
        .markAsRead(notification.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe();
    }

    // Open notification detail modal with callback to close panel
    this.dialog.open(NotificationDetailModalComponent, {
      data: {
        notification,
        closePanel: () => this.dialogRef.close(),
      },
      panelClass: 'notification-detail-dialog',
    });
  }

  /**
   * Handle notification click (deprecated - now use expand button)
   */
  onNotificationClick(notification: Notification): void {
    // Mark as read
    this.notificationService
      .markAsRead(notification.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();

    // Close the panel
    this.dialogRef.close();

    // Handle different notification types
    switch (notification.type) {
      case NotificationType.NODE_DISCOVERED:
      case NotificationType.NODE_REGISTRATION_REQUEST:
        // Navigate to nodes page with the request ID to highlight
        this.router.navigate(['/nodes'], {
          queryParams: { highlightRequest: notification.data?.['requestId'] },
        });
        break;

      case NotificationType.NODE_APPROVED:
      case NotificationType.NODE_REJECTED:
        // Navigate to nodes page
        this.router.navigate(['/nodes']);
        break;

      case NotificationType.ENCODING_COMPLETE:
      case NotificationType.ENCODING_FAILED:
        // Navigate to queue page
        this.router.navigate(['/queue']);
        break;
    }
  }

  /**
   * Archive notification
   */
  onArchive(event: Event, notification: Notification): void {
    event.stopPropagation();

    // Move to archived
    this.archivedNotifications = [notification, ...this.archivedNotifications];
    this.notifications = this.notifications.filter((n) => n.id !== notification.id);
    this.cdr.markForCheck();

    // Also mark as dismissed on the server
    this.notificationService
      .dismiss(notification.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  /**
   * Dismiss notification (remove from archive)
   */
  onDismiss(event: Event, notification: Notification): void {
    event.stopPropagation();

    this.notificationService
      .dismiss(notification.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.archivedNotifications = this.archivedNotifications.filter(
            (n) => n.id !== notification.id
          );
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Close panel
   */
  onClose(): void {
    this.dialogRef.close();
  }

  /**
   * Get notification icon based on type
   */
  getNotificationIcon(type: NotificationType) {
    switch (type) {
      case NotificationType.NODE_DISCOVERED:
      case NotificationType.NODE_REGISTRATION_REQUEST:
        return this.icons.server;
      case NotificationType.NODE_APPROVED:
        return this.icons.checkCircle;
      case NotificationType.NODE_REJECTED:
        return this.icons.timesCircle;
      case NotificationType.ENCODING_COMPLETE:
        return this.icons.checkCircle;
      case NotificationType.ENCODING_FAILED:
        return this.icons.exclamationTriangle;
      default:
        return this.icons.bell;
    }
  }

  /**
   * Extract clean title without emojis
   */
  getCleanTitle(title: string): string {
    // Remove emojis (keeping only letters, numbers, spaces, and common punctuation)
    return title.replace(/[^\w\s\-:.,!?]/g, '').trim();
  }

  /**
   * Get description from notification (shortened version of message)
   */
  getDescription(notification: Notification): string {
    const maxLength = 80;
    if (notification.message.length <= maxLength) {
      return notification.message;
    }
    return notification.message.substring(0, maxLength) + '...';
  }

  /**
   * Get short description for compact view (even shorter - 60 chars max)
   */
  getShortDescription(notification: Notification): string {
    const maxLength = 60;
    if (notification.message.length <= maxLength) {
      return notification.message;
    }
    return notification.message.substring(0, maxLength) + '...';
  }

  /**
   * Check if notification requires action (cannot be archived)
   */
  requiresAction(notification: Notification): boolean {
    return notification.type === NotificationType.NODE_REGISTRATION_REQUEST;
  }

  /**
   * Get notification color based on priority
   */
  getNotificationColor(notification: Notification): string {
    switch (notification.priority) {
      case 'URGENT':
        return 'urgent';
      case 'HIGH':
        return 'high';
      case 'MEDIUM':
        return 'medium';
      case 'LOW':
        return 'low';
      default:
        return 'medium';
    }
  }

  /**
   * Format date relative to now
   */
  getRelativeTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }
}
