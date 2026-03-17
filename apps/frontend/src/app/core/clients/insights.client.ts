import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * DTOs for API responses
 */
interface SavingsTrendDto {
  date: string;
  savedGB: number;
  savedBytes: string;
  jobsCompleted: number;
}

interface SavingsTrendResponseDto {
  trend: SavingsTrendDto[];
  totalSavedBytes: string;
  totalSavedGB: number;
  days: number;
  timestamp: string;
}

interface CodecDistributionDto {
  codec: string;
  count: number;
  percentage: number;
}

interface CodecDistributionResponseDto {
  distribution: CodecDistributionDto[];
  totalFiles: number;
  timestamp: string;
}

interface NodePerformanceDto {
  nodeId: string;
  nodeName: string;
  acceleration: string;
  jobsCompleted: number;
  jobsFailed: number;
  successRate: number;
  totalSavedBytes: string;
  totalSavedGB: number;
  avgThroughput: number;
  status: string;
}

interface NodePerformanceResponseDto {
  nodes: NodePerformanceDto[];
  timestamp: string;
}

interface InsightsStatsDto {
  totalJobsCompleted: number;
  totalJobsFailed: number;
  totalSavedBytes: string;
  totalSavedGB: number;
  avgThroughput: number;
  successRate: number;
  timestamp: string;
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
    return this.http
      .get<SavingsTrendResponseDto>(`${this.baseUrl}/savings`, {
        params: { days: days.toString() },
      })
      .pipe(map((response) => response.trend));
  }

  /**
   * Fetch codec distribution data
   */
  getCodecDistribution(): Observable<CodecDistributionDto[]> {
    return this.http
      .get<CodecDistributionResponseDto>(`${this.baseUrl}/codecs`)
      .pipe(map((response) => response.distribution));
  }

  /**
   * Fetch node performance data
   */
  getNodePerformance(): Observable<NodePerformanceDto[]> {
    return this.http
      .get<NodePerformanceResponseDto>(`${this.baseUrl}/nodes`)
      .pipe(map((response) => response.nodes));
  }

  /**
   * Fetch overall insights statistics
   */
  getStats(): Observable<InsightsStatsDto> {
    return this.http.get<InsightsStatsDto>(`${this.baseUrl}/stats`);
  }
}
