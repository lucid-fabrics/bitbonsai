import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { MediaStatsActions } from './+state/dashboard.actions';
import { MediaStatsSelectors } from './+state/dashboard.selectors';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit {
  private readonly store = inject(Store);

  readonly stats$ = this.store.select(MediaStatsSelectors.selectMediaStats);
  readonly isLoading$ = this.store.select(MediaStatsSelectors.selectIsLoading);
  readonly error$ = this.store.select(MediaStatsSelectors.selectError);

  ngOnInit(): void {
    this.store.dispatch(MediaStatsActions.loadMediaStats());
  }

  triggerScan(): void {
    this.store.dispatch(MediaStatsActions.triggerScan());
  }
}
