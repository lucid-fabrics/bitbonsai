import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoModule } from '@ngneat/transloco';
import { interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { NotificationService } from '../../../core/services/notification.service';
import { NotificationPanelComponent } from '../notification-panel/notification-panel.component';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [TranslocoModule],
  template: `
    <button
      class="notification-bell"
      (click)="openPanel()"
      [class.has-notifications]="unreadCount() > 0"
      type="button"
      title="Notifications"
    >
      <i class="fas fa-bell"></i>
      @if (unreadCount() > 0) {
        <span class="notification-badge">{{ displayCount() }}</span>
      }
    </button>
  `,
  styles: [
    `
      .notification-bell {
        position: relative;
        background: none;
        border: none;
        color: var(--text-secondary);
        font-size: 1.25rem;
        cursor: pointer;
        padding: 0.5rem;
        border-radius: 6px;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          background: var(--hover-bg);
          color: var(--text-primary);
        }

        &.has-notifications {
          color: var(--primary-color);

          i {
            animation: ringBell 2s ease-in-out infinite;
          }
        }

        .notification-badge {
          position: absolute;
          top: 0;
          right: 0;
          background: var(--danger-color);
          color: white;
          font-size: 0.625rem;
          font-weight: 600;
          min-width: 18px;
          height: 18px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 4px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          animation: pulseScale 2s ease-in-out infinite;
        }
      }

      @keyframes ringBell {
        0%,
        100% {
          transform: rotate(0deg);
        }
        10%,
        30% {
          transform: rotate(-10deg);
        }
        20%,
        40% {
          transform: rotate(10deg);
        }
        50% {
          transform: rotate(0deg);
        }
      }

      @keyframes pulseScale {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.1);
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBellComponent implements OnInit {
  private readonly notificationService = inject(NotificationService);
  private readonly dialog = inject(Dialog);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly unreadCount = signal(0);

  ngOnInit(): void {
    // Initial count fetch
    this.fetchUnreadCount();

    // Poll for unread count every 30 seconds
    interval(30000)
      .pipe(
        switchMap(() => this.notificationService.getUnreadCount()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (response) => {
          this.unreadCount.set(response.count);
          this.cdr.markForCheck();
        },
        error: () => {
          // Silently handle errors
        },
      });

    // Listen to real-time notifications via WebSocket
    this.notificationService.notification$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // Increment count when new notification arrives
        this.unreadCount.update((count) => count + 1);
        this.cdr.markForCheck();
      });
  }

  /**
   * Fetch initial unread count
   */
  private fetchUnreadCount(): void {
    this.notificationService
      .getUnreadCount()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.unreadCount.set(response.count);
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Open notification panel
   */
  openPanel(): void {
    const dialogRef = this.dialog.open(NotificationPanelComponent, {
      width: '420px',
      maxWidth: '90vw',
      panelClass: 'notification-panel-dialog',
      hasBackdrop: true,
      backdropClass: 'notification-panel-backdrop',
      disableClose: false,
    });

    // Refresh unread count when panel closes
    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.fetchUnreadCount();
    });
  }

  /**
   * Display count (max 99+)
   */
  displayCount(): string {
    const count = this.unreadCount();
    return count > 99 ? '99+' : count.toString();
  }
}
