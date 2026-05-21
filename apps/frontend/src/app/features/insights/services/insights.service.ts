import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { InsightsClient } from '../../../core/clients/insights.client';
import { CodecDistributionBO } from '../bos/codec-distribution.bo';
import { InsightsStatsBO } from '../bos/insights-stats.bo';
import { NodePerformanceBO } from '../bos/node-performance.bo';
import { SavingsTrendBO } from '../bos/savings-trend.bo';

/**
 * Service for insights-related business logic
 *
 * Follows the Client → Service → BO pattern:
 * - InsightsClient handles HTTP calls
 * - InsightsService handles business logic and DTO → BO mapping
 * - Business Objects encapsulate domain logic
 */
@Injectable({
  providedIn: 'root',
})
export class InsightsService {
  constructor(private readonly insightsClient: InsightsClient) {}

  /**
   * Get savings trend data mapped to business objects
   */
  getSavingsTrend(days: number): Observable<SavingsTrendBO[]> {
    return this.insightsClient.getSavingsTrend(days).pipe(
      map((dtos) => {
        // Defensive check: ensure dtos is an array
        if (!Array.isArray(dtos)) {
          return [];
        }
        return dtos.map(SavingsTrendBO.fromDto);
      })
    );
  }

  /**
   * Get codec distribution data mapped to business objects
   */
  getCodecDistribution(): Observable<CodecDistributionBO[]> {
    return this.insightsClient.getCodecDistribution().pipe(
      map((dtos) => {
        // Defensive check: ensure dtos is an array
        if (!Array.isArray(dtos)) {
          return [];
        }
        return dtos.map(CodecDistributionBO.fromDto);
      })
    );
  }

  /**
   * Get node performance data mapped to business objects
   */
  getNodePerformance(): Observable<NodePerformanceBO[]> {
    return this.insightsClient.getNodePerformance().pipe(
      map((dtos) => {
        // Defensive check: ensure dtos is an array
        if (!Array.isArray(dtos)) {
          return [];
        }
        return dtos.map(NodePerformanceBO.fromDto);
      })
    );
  }

  /**
   * Get overall insights statistics mapped to business object
   */
  getStats(): Observable<InsightsStatsBO> {
    return this.insightsClient.getStats().pipe(map(InsightsStatsBO.fromDto));
  }
}
