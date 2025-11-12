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
import { interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { NodesClient } from '../../../core/clients/nodes.client';
import type { RegistrationRequest } from '../../../features/nodes/models/registration-request.model';

@Component({
  selector: 'app-pending-requests-bell',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pending-requests-bell.component.html',
  styleUrls: ['./pending-requests-bell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingRequestsBellComponent implements OnInit {
  private readonly nodesClient = inject(NodesClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  // State
  pendingCount = 0;
  private previousCount = 0;
  shouldAnimate = false;

  ngOnInit(): void {
    this.loadPendingCount();
    this.startPolling();
  }

  /**
   * Load pending requests count
   */
  private loadPendingCount(): void {
    this.nodesClient
      .getPendingRequests()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (requests: RegistrationRequest[]) => {
          this.updateCount(requests.length);
        },
        error: () => {
          // Silently handle errors
        },
      });
  }

  /**
   * Start polling for new requests every 30 seconds
   */
  private startPolling(): void {
    interval(30000)
      .pipe(
        switchMap(() => this.nodesClient.getPendingRequests()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (requests: RegistrationRequest[]) => {
          this.updateCount(requests.length);
        },
        error: () => {
          // Silently handle errors
        },
      });
  }

  /**
   * Update count and trigger animation if count increased
   */
  private updateCount(newCount: number): void {
    // If count increased, trigger animation
    if (newCount > this.previousCount) {
      this.shouldAnimate = true;
      // Reset animation after 1 second
      setTimeout(() => {
        this.shouldAnimate = false;
        this.cdr.markForCheck();
      }, 1000);
    }

    this.previousCount = this.pendingCount;
    this.pendingCount = newCount;
    this.cdr.markForCheck();
  }
}
