import { RevenueMetrics } from '../../services/api.service';

/**
 * Business Object for Dashboard
 * ALL business logic for dashboard component MUST live here
 */
export class DashboardBo {
  /**
   * Get tier entries as array of tuples for template iteration
   */
  static getTierEntries(revenueByTier: Record<string, number> | undefined): [string, number][] {
    if (!revenueByTier) return [];
    return Object.entries(revenueByTier);
  }

  /**
   * Format error message for metric loading failure
   */
  static getErrorMessage(_error: Error): string {
    return 'Failed to load dashboard metrics. Please try again.';
  }

  /**
   * Check if metrics data is valid
   */
  static hasValidMetrics(metrics: RevenueMetrics | null): boolean {
    return metrics !== null;
  }

  /**
   * Check if subscription health data exists
   */
  static hasSubscriptionHealth(metrics: RevenueMetrics | null): boolean {
    return !!metrics?.subscriptionHealth;
  }

  /**
   * Check if revenue by tier data exists
   */
  static hasRevenueByTier(metrics: RevenueMetrics | null): boolean {
    return !!metrics?.revenueByTier && Object.keys(metrics.revenueByTier).length > 0;
  }
}
