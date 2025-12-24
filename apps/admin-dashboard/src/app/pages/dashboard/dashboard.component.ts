import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { ApiService, RevenueMetrics } from '../../services/api.service';

@Component({
  selector: 'bb-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bb-dashboard">
      <h1 class="bb-page-title">Dashboard</h1>

      @if (metrics) {
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

        <div class="bb-section">
          <h2>Revenue by Tier</h2>
          <div class="bb-tier-list">
            @for (tier of getTierEntries(); track tier[0]) {
              <div class="bb-tier-item">
                <span class="bb-tier-item__name">{{ tier[0] }}</span>
                <span class="bb-tier-item__value">{{ tier[1] | currency }}</span>
              </div>
            }
          </div>
        </div>
      } @else {
        <div class="bb-loading">Loading metrics...</div>
      }
    </div>
  `,
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  private readonly apiService = inject(ApiService);

  metrics: RevenueMetrics | null = null;

  ngOnInit() {
    this.loadMetrics();
  }

  loadMetrics() {
    this.apiService.getRevenueMetrics().subscribe({
      next: (metrics) => {
        this.metrics = metrics;
      },
      error: (error) => {
        console.error('Failed to load metrics:', error);
      },
    });
  }

  getTierEntries(): [string, number][] {
    if (!this.metrics?.revenueByTier) return [];
    return Object.entries(this.metrics.revenueByTier);
  }
}
