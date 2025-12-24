import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { Store } from '@ngrx/store';
import * as DashboardActions from './+state/dashboard.actions';
import { selectError, selectLoading, selectMetrics } from './+state/dashboard.selectors';
import { DashboardBo } from './dashboard.bo';

@Component({
  selector: 'bb-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bb-dashboard">
      <h1 class="bb-page-title">Dashboard</h1>

      @if (metrics$ | async; as metrics) {
        <div class="bb-metrics-grid">
          <div class="bb-metric-card">
            <div class="bb-metric-card__label">Monthly Recurring Revenue</div>
            <div class="bb-metric-card__value">{{ metrics.mrr | currency }}</div>
          </div>

          <div class="bb-metric-card">
            <div class="bb-metric-card__label">Annual Recurring Revenue</div>
            <div class="bb-metric-card__value">{{ metrics.arr | currency }}</div>
          </div>

          <div class="bb-metric-card">
            <div class="bb-metric-card__label">Active Subscriptions</div>
            <div class="bb-metric-card__value">{{ metrics.activeSubscriptions }}</div>
          </div>

          <div class="bb-metric-card">
            <div class="bb-metric-card__label">Customer Lifetime Value</div>
            <div class="bb-metric-card__value">{{ metrics.clv | currency }}</div>
          </div>

          <div class="bb-metric-card">
            <div class="bb-metric-card__label">Churn Rate</div>
            <div class="bb-metric-card__value">{{ metrics.churnRate | number: '1.1-1' }}%</div>
          </div>

          <div class="bb-metric-card">
            <div class="bb-metric-card__label">New This Month</div>
            <div class="bb-metric-card__value">{{ metrics.newSubscriptionsThisMonth }}</div>
          </div>
        </div>

        @if (DashboardBo.hasSubscriptionHealth(metrics)) {
          <div class="bb-section">
            <h2>Subscription Health</h2>
            <div class="bb-health-grid">
              <div class="bb-health-card bb-health-card--success">
                <div class="bb-health-card__value">{{ metrics.subscriptionHealth.healthy }}</div>
                <div class="bb-health-card__label">Healthy</div>
              </div>
              <div class="bb-health-card bb-health-card--warning">
                <div class="bb-health-card__value">{{ metrics.subscriptionHealth.expiringSoon }}</div>
                <div class="bb-health-card__label">Expiring Soon</div>
              </div>
              <div class="bb-health-card bb-health-card--danger">
                <div class="bb-health-card__value">{{ metrics.subscriptionHealth.overdue }}</div>
                <div class="bb-health-card__label">Overdue</div>
              </div>
            </div>
          </div>
        }

        @if (DashboardBo.hasRevenueByTier(metrics)) {
          <div class="bb-section">
            <h2>Revenue by Tier</h2>
            <div class="bb-tier-list">
              @for (tier of DashboardBo.getTierEntries(metrics.revenueByTier); track tier[0]) {
                <div class="bb-tier-item">
                  <span class="bb-tier-item__name">{{ tier[0] }}</span>
                  <span class="bb-tier-item__value">{{ tier[1] | currency }}</span>
                </div>
              }
            </div>
          </div>
        }
      } @else if (loading$ | async) {
        <div class="bb-loading">Loading metrics...</div>
      } @else if (error$ | async; as error) {
        <div class="bb-error">{{ error }}</div>
      }
    </div>
  `,
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  private readonly store = inject(Store);

  // Expose BO to template (convention requirement)
  readonly DashboardBo = DashboardBo;

  // Selectors (NgRx state)
  metrics$ = this.store.select(selectMetrics);
  loading$ = this.store.select(selectLoading);
  error$ = this.store.select(selectError);

  /**
   * Component initialization
   * Delegates to NgRx effect (NO logic in component!)
   */
  ngOnInit(): void {
    this.store.dispatch(DashboardActions.loadMetrics());
  }
}
