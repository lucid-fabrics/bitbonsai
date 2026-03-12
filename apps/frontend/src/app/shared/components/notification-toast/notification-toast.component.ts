import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  inject,
  OnInit,
  Output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faBell,
  faCheckCircle,
  faCircleCheck,
  faExclamationTriangle,
  faSatelliteDish,
  faXmark,
} from '@fortawesome/pro-solid-svg-icons';
import { TranslocoModule } from '@ngneat/transloco';
import { timer } from 'rxjs';
import type { Notification } from '../../../core/models/notification.model';

@Component({
  selector: 'app-notification-toast',
  standalone: true,
  imports: [FaIconComponent, TranslocoModule],
  templateUrl: './notification-toast.component.html',
  styleUrl: './notification-toast.component.scss',
})
export class NotificationToastComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  @Input() notification!: Notification;
  @Input() autoDismissDelay = 5000; // 5 seconds

  @Output() dismiss = new EventEmitter<string>();
  @Output() action = new EventEmitter<Notification>();

  readonly isVisible = signal(true);
  readonly isPaused = signal(false);

  // Icons
  readonly faSatelliteDish = faSatelliteDish;
  readonly faCheckCircle = faCheckCircle;
  readonly faCircleCheck = faCircleCheck;
  readonly faExclamationTriangle = faExclamationTriangle;
  readonly faBell = faBell;
  readonly faXmark = faXmark;

  ngOnInit(): void {
    this.startAutoDismissTimer();
  }

  /**
   * Start auto-dismiss timer
   */
  private startAutoDismissTimer(): void {
    timer(this.autoDismissDelay)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.isPaused()) {
          this.dismissToast();
        }
      });
  }

  /**
   * Pause auto-dismiss (on hover)
   */
  pause(): void {
    this.isPaused.set(true);
  }

  /**
   * Resume auto-dismiss (on mouse leave)
   */
  resume(): void {
    this.isPaused.set(false);
  }

  /**
   * Dismiss the toast
   */
  dismissToast(): void {
    this.isVisible.set(false);
    setTimeout(() => {
      this.dismiss.emit(this.notification.id);
    }, 300); // Wait for slide-out animation
  }

  /**
   * Handle action button click
   */
  handleAction(): void {
    this.action.emit(this.notification);
    this.dismissToast();
  }

  /**
   * Navigate to discovery page
   */
  navigateToDiscovery(): void {
    this.router.navigate(['/discovery']);
    this.dismissToast();
  }

  /**
   * Get icon based on notification type
   */
  getIcon(): typeof faBell {
    switch (this.notification.type) {
      case 'NODE_DISCOVERED':
        return faSatelliteDish;
      case 'NODE_APPROVED':
        return faCircleCheck;
      case 'NODE_REJECTED':
        return faXmark;
      case 'ENCODING_COMPLETE':
        return faCheckCircle;
      case 'ENCODING_FAILED':
        return faExclamationTriangle;
      default:
        return faBell;
    }
  }

  /**
   * Get color class based on notification type
   */
  getColorClass(): string {
    switch (this.notification.type) {
      case 'NODE_DISCOVERED':
        return 'notification-info';
      case 'NODE_APPROVED':
        return 'notification-success';
      case 'NODE_REJECTED':
        return 'notification-warning';
      case 'ENCODING_COMPLETE':
        return 'notification-success';
      case 'ENCODING_FAILED':
        return 'notification-error';
      default:
        return 'notification-info';
    }
  }

  /**
   * Check if notification type requires action buttons
   */
  hasActions(): boolean {
    return this.notification.type === 'NODE_DISCOVERED';
  }
}
