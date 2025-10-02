import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * DTOs for API responses
 */
interface SavingsTrendDto {
  date: string;
  savingsGB: number;
}

interface CodecDistributionDto {
  codec: string;
  count: number;
  percentage: number;
}

interface NodePerformanceDto {
  nodeName: string;
  jobsCompleted: number;
  successRate: number;
}

interface InsightsStatsDto {
  totalJobsCompleted: number;
  totalStorageSavedGB: number;
  averageSuccessRate: number;
  averageThroughput: number;
}

/**
 * HTTP client for insights-related API calls
 *
 * This client is responsible ONLY for HTTP communication.
 * Business logic belongs in InsightsService.
 */
@Injectable({
  providedIn: 'root',
})
export class InsightsClient {
  private readonly baseUrl = '/api/v1/insights';

  constructor(private readonly http: HttpClient) {}

  /**
   * Fetch savings trend data for the specified number of days
   */
  getSavingsTrend(days: number): Observable<SavingsTrendDto[]> {
    return this.http.get<SavingsTrendDto[]>(`${this.baseUrl}/savings`, {
      params: { days: days.toString() },
    });
  }

  /**
   * Fetch codec distribution data
   */
  getCodecDistribution(): Observable<CodecDistributionDto[]> {
    return this.http.get<CodecDistributionDto[]>(`${this.baseUrl}/codecs`);
  }

  /**
   * Fetch node performance data
   */
  getNodePerformance(): Observable<NodePerformanceDto[]> {
    return this.http.get<NodePerformanceDto[]>(`${this.baseUrl}/nodes`);
  }

  /**
   * Fetch overall insights statistics
   */
  getStats(): Observable<InsightsStatsDto> {
    return this.http.get<InsightsStatsDto>(`${this.baseUrl}/stats`);
  }
}
