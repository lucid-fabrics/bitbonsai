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
import { interval } from 'rxjs';
import { startWith, switchMap } from 'rxjs/operators';
import { NodesClient } from '../../../core/clients/nodes.client';

/**
 * Notification bell component that shows pending registration requests count
 * Polls every 30 seconds for new requests
 */
@Component({
  selector: 'app-pending-requests-bell',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="notification-bell" (click)="navigateToPendingRequests()" [class.has-pending]="pendingCount > 0">
      <div class="bell-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>

        @if (pendingCount > 0) {
          <span class="badge" [class.pulse]="pendingCount > 0">
            {{ pendingCount > 99 ? '99+' : pendingCount }}
          </span>
        }
      </div>

      @if (pendingCount > 0) {
        <span class="tooltip">
          {{ pendingCount }} {{ pendingCount === 1 ? 'pending request' : 'pending requests' }}
        </span>
      }
    </div>
  `,
  styles: [
    `
    .notification-bell {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      cursor: pointer;
      transition: all 0.2s;
      border-radius: 8px;

      &:hover {
        background: var(--bb-hover);
      }

      &.has-pending {
        &:hover .tooltip {
          opacity: 1;
          visibility: visible;
          transform: translateY(0);
        }
      }
    }

    .bell-icon {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;

      svg {
        width: 20px;
        height: 20px;
        color: var(--bb-text-secondary);
        transition: all 0.2s;
      }

      .notification-bell:hover & svg {
        color: var(--bb-text-primary);
      }

      .notification-bell.has-pending & svg {
        color: var(--bb-primary);
        animation: ring 2s ease-in-out infinite;
      }
    }

    @keyframes ring {
      0%, 100% {
        transform: rotate(0deg);
      }
      10%, 30% {
        transform: rotate(-10deg);
      }
      20%, 40% {
        transform: rotate(10deg);
      }
      50% {
        transform: rotate(0deg);
      }
    }

    .badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      background: var(--bb-danger);
      color: white;
      border-radius: 9px;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid var(--bb-surface);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

      &.pulse {
        animation: pulse 2s ease-in-out infinite;
      }
    }

    @keyframes pulse {
      0%, 100% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.1);
      }
    }

    .tooltip {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      background: var(--bb-surface);
      color: var(--bb-text-primary);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      opacity: 0;
      visibility: hidden;
      transform: translateY(-4px);
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      border: 1px solid var(--bb-border);
      z-index: 1000;

      &::before {
        content: '';
        position: absolute;
        top: -4px;
        right: 12px;
        width: 8px;
        height: 8px;
        background: var(--bb-surface);
        border-top: 1px solid var(--bb-border);
        border-left: 1px solid var(--bb-border);
        transform: rotate(45deg);
      }
    }
  `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingRequestsBellComponent implements OnInit {
  private readonly nodesClient = inject(NodesClient);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  pendingCount = 0;

  ngOnInit(): void {
    this.startPolling();
  }

  /**
   * Poll for pending requests every 30 seconds
   */
  private startPolling(): void {
    interval(30000)
      .pipe(
        startWith(0), // Emit immediately on init
        switchMap(() => this.nodesClient.getPendingRequests()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (requests) => {
          this.pendingCount = requests.length;
          this.cdr.markForCheck();
        },
        error: () => {
          // Silently ignore polling errors
        },
      });
  }

  /**
   * Navigate to pending requests page
   */
  navigateToPendingRequests(): void {
    this.router.navigate(['/pending-requests']);
  }
}
