import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faBell,
  faCheckCircle,
  faExclamationTriangle,
  faServer,
  faTimes,
  faTimesCircle,
} from '@fortawesome/pro-solid-svg-icons';
import { TranslocoModule } from '@ngneat/transloco';
import type { Notification } from '../../../core/models/notification.model';
import { NotificationType } from '../../../core/models/notification.model';

interface ModalData {
  notification: Notification;
  closePanel: () => void;
}

@Component({
  selector: 'app-notification-detail-modal',
  standalone: true,
  imports: [FontAwesomeModule, TranslocoModule],
  styleUrls: ['./notification-detail-modal.component.scss'],
  template: `
    <div
      class="notification-detail-modal"
      [style.--accent-color]="getAccentColor()"
    >
      <div class="notification-detail-modal__header">
        <div class="notification-detail-modal__icon">
          <fa-icon [icon]="getIcon()" size="lg"></fa-icon>
        </div>
        <div class="notification-detail-modal__header-content">
          <h2 class="notification-detail-modal__title">
            {{ getCleanTitle(notification.title) }}
          </h2>
          <div class="notification-detail-modal__meta">
            <span
              class="notification-detail-modal__priority notification-detail-modal__priority--{{
                notification.priority.toLowerCase()
              }}"
            >
              {{ notification.priority }}
            </span>
            <span>{{ getRelativeTime(notification.createdAt) }}</span>
          </div>
        </div>
        <button
          class="notification-detail-modal__close-btn"
          (click)="onClose()"
          type="button"
        >
          <fa-icon [icon]="icons.close"></fa-icon>
        </button>
      </div>

      <div class="notification-detail-modal__body">
        <p class="notification-detail-modal__message">
          {{ notification.message }}
        </p>

        @if (notification.data && Object.keys(notification.data).length > 0) {
          <div class="notification-detail-modal__data">
            <h4>Additional Details</h4>
            <dl>
              @for (entry of getDataEntries(); track entry.key) {
                <div class="notification-detail-modal__data-row">
                  <dt>{{ formatKey(entry.key) }}</dt>
                  <dd>{{ entry.value }}</dd>
                </div>
              }
            </dl>
          </div>
        }
      </div>

      <div class="notification-detail-modal__footer">
        @if (requiresAction()) {
          <button
            class="notification-detail-modal__btn notification-detail-modal__btn--primary"
            (click)="onTakeAction()"
            type="button"
          >
            Take Action
          </button>
        }
        <button
          class="notification-detail-modal__btn notification-detail-modal__btn--secondary"
          (click)="onClose()"
          type="button"
        >
          Close
        </button>
      </div>
    </div>
  `,
})
export class NotificationDetailModalComponent {
  private readonly data = inject<ModalData>(DIALOG_DATA);
  readonly notification = this.data.notification;
  private readonly closePanel = this.data.closePanel;
  private readonly dialogRef = inject(DialogRef);
  private readonly router = inject(Router);

  readonly Object = Object;

  readonly icons = {
    bell: faBell,
    close: faTimes,
    server: faServer,
    checkCircle: faCheckCircle,
    timesCircle: faTimesCircle,
    exclamationTriangle: faExclamationTriangle,
  };

  getIcon() {
    switch (this.notification.type) {
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

  getAccentColor(): string {
    switch (this.notification.priority) {
      case 'URGENT':
        return '#dc3545';
      case 'HIGH':
        return '#fd7e14';
      case 'MEDIUM':
        return '#0dcaf0';
      case 'LOW':
        return '#6c757d';
      default:
        return '#0dcaf0';
    }
  }

  getCleanTitle(title: string): string {
    return title.replace(/[^\w\s\-:.,!?]/g, '').trim();
  }

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

  getDataEntries(): { key: string; value: string }[] {
    if (!this.notification.data) return [];
    return Object.entries(this.notification.data).map(([key, value]) => ({
      key,
      value: String(value),
    }));
  }

  formatKey(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  }

  requiresAction(): boolean {
    return this.notification.type === NotificationType.NODE_REGISTRATION_REQUEST;
  }

  onTakeAction(): void {
    // Close the modal
    this.dialogRef.close();

    // Close the notification panel
    this.closePanel();

    // Navigate based on notification type
    switch (this.notification.type) {
      case NotificationType.NODE_DISCOVERED:
      case NotificationType.NODE_REGISTRATION_REQUEST:
        this.router.navigate(['/nodes'], {
          queryParams: { highlightRequest: this.notification.data?.requestId },
        });
        break;

      case NotificationType.NODE_APPROVED:
      case NotificationType.NODE_REJECTED:
        this.router.navigate(['/nodes']);
        break;

      case NotificationType.ENCODING_COMPLETE:
      case NotificationType.ENCODING_FAILED:
        this.router.navigate(['/queue']);
        break;
    }
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
