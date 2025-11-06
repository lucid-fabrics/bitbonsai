import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  fromEvent,
  interval,
  map,
  type Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';
import { DiscoveryClient } from '../../core/clients/discovery.client';
import { ToastService } from '../../core/services/toast.service';
import { DiscoveryNodeBo } from './bos/discovery-node.bo';
import type { DiscoveredNode } from './models/discovered-node.model';
import { DiscoveryStatus } from './models/discovered-node.model';
import type { ManagedNode } from './models/managed-node.model';

interface DiscoveryData {
  discoveredNodes: DiscoveredNode[];
  managedNodes: ManagedNode[];
}

@Component({
  selector: 'app-discovery',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule],
  templateUrl: './discovery.page.html',
  styleUrls: ['./discovery.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryComponent implements OnInit {
  private readonly discoveryApi = inject(DiscoveryClient);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  // Expose enums and BOs for template
  protected readonly DiscoveryStatus = DiscoveryStatus;
  protected readonly DiscoveryNodeBo = DiscoveryNodeBo;

  // Observables for reactive state
  private readonly refreshTrigger$ = new BehaviorSubject<{ showLoading: boolean }>({
    showLoading: true,
  });
  private readonly loadingSubject$ = new BehaviorSubject<boolean>(true);
  protected readonly discoveryData$: Observable<DiscoveryData | null>;
  protected readonly isLoading$: Observable<boolean>;

  // State for actions in progress
  protected approvingNodeIds = new Set<string>();
  protected rejectingNodeIds = new Set<string>();

  constructor() {
    // Create observable stream for discovery data
    this.discoveryData$ = this.refreshTrigger$.pipe(
      switchMap(({ showLoading }) => {
        // Only show loading for user-initiated actions, not polling
        if (showLoading) {
          this.loadingSubject$.next(true);
        }

        // Fetch both discovered and managed nodes
        return combineLatest([
          this.discoveryApi.getDiscoveredNodes().pipe(catchError(() => of([]))),
          this.discoveryApi.getManagedNodes().pipe(catchError(() => of([]))),
        ]).pipe(
          map(([discoveredNodes, managedNodes]) => {
            // Always clear loading when data arrives
            this.loadingSubject$.next(false);
            return { discoveredNodes, managedNodes };
          }),
          catchError(() => {
            // Always clear loading on error
            this.loadingSubject$.next(false);
            return of(null);
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Use the loading subject as the loading observable
    this.isLoading$ = this.loadingSubject$.asObservable();
  }

  ngOnInit(): void {
    this.startPolling();
  }

  private startPolling(): void {
    // Create visibility change observable
    const visibilityChange$ = fromEvent(document, 'visibilitychange').pipe(
      startWith(null), // Emit immediately on subscription
      map(() => document.visibilityState === 'visible')
    );

    // Poll only when page is visible
    visibilityChange$
      .pipe(
        switchMap(
          (isVisible) =>
            isVisible
              ? interval(5000).pipe(startWith(0)) // Poll immediately and every 5s when visible
              : [] // Stop polling when hidden
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        // Silent refresh for polling - don't show loading spinner
        this.refreshTrigger$.next({ showLoading: false });
      });
  }

  protected refreshDiscovery(showLoading = false): void {
    this.refreshTrigger$.next({ showLoading });
  }

  protected onApproveNode(node: DiscoveredNode, event: Event): void {
    event.stopPropagation();

    this.approvingNodeIds.add(node.id);

    this.discoveryApi
      .approveNode({ discoveredNodeId: node.id })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.toastService.success(`${node.name} approved and added to network`);
            this.refreshDiscovery(true);
          } else {
            this.toastService.error('Failed to approve node');
          }
          this.approvingNodeIds.delete(node.id);
        },
        error: (err) => {
          const errorMessage = err?.error?.message || 'Failed to approve node';
          this.toastService.error(errorMessage);
          this.approvingNodeIds.delete(node.id);
        },
      });
  }

  protected onRejectNode(node: DiscoveredNode, event: Event): void {
    event.stopPropagation();

    this.rejectingNodeIds.add(node.id);

    this.discoveryApi
      .rejectNode({ discoveredNodeId: node.id })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.toastService.info(`${node.name} ignored`);
            this.refreshDiscovery(true);
          } else {
            this.toastService.error('Failed to reject node');
          }
          this.rejectingNodeIds.delete(node.id);
        },
        error: (err) => {
          const errorMessage = err?.error?.message || 'Failed to reject node';
          this.toastService.error(errorMessage);
          this.rejectingNodeIds.delete(node.id);
        },
      });
  }

  protected isApproving(nodeId: string): boolean {
    return this.approvingNodeIds.has(nodeId);
  }

  protected isRejecting(nodeId: string): boolean {
    return this.rejectingNodeIds.has(nodeId);
  }

  protected getPendingNodes(nodes: DiscoveredNode[]): DiscoveredNode[] {
    return nodes.filter((node) => node.status === DiscoveryStatus.PENDING);
  }

  protected formatMemory(memoryGB: number): string {
    return `${memoryGB} GB`;
  }

  protected formatCores(cores: number): string {
    return `${cores} cores`;
  }

  protected formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    // If less than 1 hour ago, show relative time
    if (diffMins < 60) {
      if (diffMins < 1) return 'Just now';
      if (diffMins === 1) return '1 minute ago';
      return `${diffMins} minutes ago`;
    }

    // Otherwise show formatted date
    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    };
    return date.toLocaleDateString('en-US', options);
  }
}
