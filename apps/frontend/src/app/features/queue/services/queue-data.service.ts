import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import {
  BehaviorSubject,
  catchError,
  fromEvent,
  interval,
  map,
  type Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';
import { selectCurrentNode } from '../../../core/+state/current-node.selectors';
import { DistributionClient, type NodeCapacity } from '../../../core/clients/distribution.client';
import { NodesClient } from '../../../core/clients/nodes.client';
import { SettingsClient } from '../../../core/clients/settings.client';
import type { Node as NodeModel } from '../../nodes/models/node.model';
import { SettingsActions } from '../../settings/+state/settings.actions';
import { SettingsSelectors } from '../../settings/+state/settings.selectors';
import { JobStatus } from '../models/job-status.enum';
import type { QueueFilters } from '../models/queue-filters.model';
import type { QueueResponse } from '../models/queue-response.model';
import { QueueService } from './queue.service';

@Injectable({
  providedIn: 'root',
})
export class QueueDataService {
  private readonly queueService = inject(QueueService);
  private readonly nodesApi = inject(NodesClient);
  private readonly settingsApi = inject(SettingsClient);
  private readonly distributionApi = inject(DistributionClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(Store);

  // Filter state
  selectedStatus: JobStatus | 'ALL' = JobStatus.ENCODING;
  selectedNodeId = '';
  selectedLibraryId = '';
  searchQuery = '';

  // Pagination state
  currentPage = 1;
  pageSize = 20;

  // Available statuses for filter (exclude transient statuses that jobs pass through quickly)
  readonly statuses: Array<JobStatus | 'ALL'> = [
    'ALL',
    JobStatus.NEEDS_DECISION,
    JobStatus.QUEUED,
    JobStatus.TRANSFERRING,
    JobStatus.ENCODING,
    JobStatus.PAUSED,
    JobStatus.COMPLETED,
    JobStatus.FAILED,
    JobStatus.CANCELLED,
  ];

  private readonly refreshTrigger$ = new BehaviorSubject<{ showLoading: boolean }>({
    showLoading: true,
  });
  private readonly loadingSubject$ = new BehaviorSubject<boolean>(true);

  readonly queueData$: Observable<QueueResponse | null>;
  readonly isLoading$: Observable<boolean>;
  readonly availableNodes$: Observable<Map<string, string>>;
  readonly availableNodesWithRole$: Observable<NodeModel[]>;
  readonly availableLibraries$: Observable<Map<string, { name: string; nodeName: string }>>;
  readonly isMainNode$: Observable<boolean>;
  readonly nodeCapacity$: Observable<NodeCapacity[]>;
  readonly advancedMode: ReturnType<typeof toSignal<boolean>>;

  constructor() {
    this.queueData$ = this.refreshTrigger$.pipe(
      switchMap(({ showLoading }) => {
        if (showLoading) this.loadingSubject$.next(true);

        return this.queueService.getQueue(this.buildFilters()).pipe(
          map((data) => {
            this.loadingSubject$.next(false);
            return data;
          }),
          catchError(() => {
            this.loadingSubject$.next(false);
            return of(null);
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.isLoading$ = this.loadingSubject$.asObservable();

    const nodesData$ = this.nodesApi
      .getNodes()
      .pipe(shareReplay({ bufferSize: 1, refCount: true }));

    this.availableNodes$ = nodesData$.pipe(
      map((nodes) => {
        const nodeMap = new Map<string, string>();
        for (const node of nodes) nodeMap.set(node.id, node.name);
        return nodeMap;
      })
    );

    this.availableNodesWithRole$ = nodesData$;

    this.availableLibraries$ = this.queueData$.pipe(
      map((data) => {
        const jobs = data?.jobs || [];
        const libraryMap = new Map<string, { name: string; nodeName: string }>();
        for (const job of jobs) {
          if (job.libraryId && job.libraryName && job.nodeName) {
            libraryMap.set(job.libraryId, { name: job.libraryName, nodeName: job.nodeName });
          }
        }
        return libraryMap;
      })
    );

    this.isMainNode$ = this.store.select(selectCurrentNode).pipe(
      map((node) => node?.role === 'MAIN'),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.nodeCapacity$ = interval(10000).pipe(
      startWith(0),
      switchMap(() =>
        this.distributionApi.getCapacity().pipe(
          map((response) =>
            [...response.nodes].sort((a, b) => {
              if (a.role === 'MAIN') return -1;
              if (b.role === 'MAIN') return 1;
              return a.nodeName.localeCompare(b.nodeName);
            })
          ),
          catchError(() => of([]))
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.advancedMode = toSignal(this.store.select(SettingsSelectors.selectAdvancedMode), {
      initialValue: false,
    });
  }

  init(destroyRef: DestroyRef): void {
    this.store.dispatch(SettingsActions.loadAdvancedMode());

    this.store
      .select(selectCurrentNode)
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((currentNode) => {
        if (currentNode && !this.selectedNodeId && currentNode.role === 'LINKED') {
          this.selectedNodeId = currentNode.id;
          this.onNodeFilterChange(currentNode.id);
        }
      });

    this.settingsApi
      .getDefaultQueueView()
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe({
        next: (settings) => {
          if (
            settings.defaultQueueView &&
            this.statuses.includes(settings.defaultQueueView as JobStatus | 'ALL')
          ) {
            this.selectedStatus = settings.defaultQueueView as JobStatus | 'ALL';
          }
        },
        error: () => {
          // If settings can't be loaded, fallback to ENCODING (default behavior)
        },
      });

    this.route.queryParams.pipe(takeUntilDestroyed(destroyRef)).subscribe((params) => {
      if (params.status && this.statuses.includes(params.status as JobStatus | 'ALL')) {
        this.selectedStatus = params.status as JobStatus | 'ALL';
      }
      if (params.nodeId) this.selectedNodeId = params.nodeId;
      if (params.libraryId) this.selectedLibraryId = params.libraryId;
      if (params.search) this.searchQuery = params.search;
    });

    this.startPolling(destroyRef);
  }

  private startPolling(destroyRef: DestroyRef): void {
    const visibilityChange$ = fromEvent(document, 'visibilitychange').pipe(
      startWith(null),
      map(() => document.visibilityState === 'visible')
    );

    visibilityChange$
      .pipe(
        switchMap((isVisible) => (isVisible ? interval(5000).pipe(startWith(0)) : [])),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe(() => {
        this.refreshTrigger$.next({ showLoading: false });
      });
  }

  buildFilters(): QueueFilters {
    const filters: QueueFilters = {};
    if (this.selectedStatus !== 'ALL') filters.status = this.selectedStatus as JobStatus;
    if (this.selectedNodeId) filters.nodeId = this.selectedNodeId;
    if (this.selectedLibraryId) filters.libraryId = this.selectedLibraryId;
    if (this.searchQuery) filters.search = this.searchQuery;
    filters.page = this.currentPage;
    filters.limit = this.pageSize;
    return filters;
  }

  refreshQueue(showLoading = false): void {
    this.refreshTrigger$.next({ showLoading });
  }

  onStatusFilterChange(status: JobStatus | 'ALL', destroyRef: DestroyRef): void {
    this.selectedStatus = status;
    this.currentPage = 1;
    this.updateQueryParams();
    this.refreshQueue(true);

    this.settingsApi
      .updateDefaultQueueView(status)
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe({ error: () => {} });
  }

  onNodeFilterChange(nodeId: string): void {
    this.selectedNodeId = nodeId;
    this.currentPage = 1;
    this.updateQueryParams();
    this.refreshQueue(true);
  }

  onLibraryFilterChange(libraryId: string): void {
    this.selectedLibraryId = libraryId;
    this.currentPage = 1;
    this.updateQueryParams();
    this.refreshQueue(true);
  }

  onSearchChange(query: string): void {
    this.searchQuery = query;
    this.currentPage = 1;
    this.updateQueryParams();
    this.refreshQueue(true);
  }

  clearAllFilters(): void {
    this.selectedStatus = 'ALL';
    this.selectedNodeId = '';
    this.selectedLibraryId = '';
    this.searchQuery = '';
    this.updateQueryParams();
    this.refreshQueue(true);
  }

  updateQueryParams(): void {
    const queryParams: {
      status?: string;
      nodeId?: string;
      libraryId?: string;
      search?: string;
    } = {};

    if (this.selectedStatus !== 'ALL') queryParams.status = this.selectedStatus;
    if (this.selectedNodeId) queryParams.nodeId = this.selectedNodeId;
    if (this.selectedLibraryId) queryParams.libraryId = this.selectedLibraryId;
    if (this.searchQuery) queryParams.search = this.searchQuery;

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  onPageSizeChange(newSize: number): void {
    this.pageSize = newSize;
    this.currentPage = 1;
    this.refreshTrigger$.next({ showLoading: true });
  }

  goToPage(page: number): void {
    this.currentPage = page;
    this.refreshTrigger$.next({ showLoading: true });
  }
}
