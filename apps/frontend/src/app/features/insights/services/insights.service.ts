import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  CodecDistributionBO,
  InsightsStatsBO,
  NodePerformanceBO,
  SavingsTrendBO,
} from '../bos/insights.bo';
// biome-ignore lint/style/useImportType: Angular DI requires regular import for injection token
import { InsightsClient } from './insights.client';

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
    return this.insightsClient
      .getSavingsTrend(days)
      .pipe(map((dtos) => dtos.map(SavingsTrendBO.fromDto)));
  }

  /**
   * Get codec distribution data mapped to business objects
   */
  getCodecDistribution(): Observable<CodecDistributionBO[]> {
    return this.insightsClient
      .getCodecDistribution()
      .pipe(map((dtos) => dtos.map(CodecDistributionBO.fromDto)));
  }

  /**
   * Get node performance data mapped to business objects
   */
  getNodePerformance(): Observable<NodePerformanceBO[]> {
    return this.insightsClient
      .getNodePerformance()
      .pipe(map((dtos) => dtos.map(NodePerformanceBO.fromDto)));
  }

  /**
   * Get overall insights statistics mapped to business object
   */
  getStats(): Observable<InsightsStatsBO> {
    return this.insightsClient.getStats().pipe(map(InsightsStatsBO.fromDto));
  }
}
