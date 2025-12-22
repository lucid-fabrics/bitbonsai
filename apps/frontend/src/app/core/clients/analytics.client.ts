import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export type TimePeriod = '24h' | '7d' | '30d' | '90d' | 'all';

export interface SpaceSavingsDataPoint {
  date: string;
  savedBytes: number;
  savedPercent: number;
  jobCount: number;
}

export interface EncodingSpeedDataPoint {
  date: string;
  avgFps: number;
  avgBytesPerSecond: number;
  codec: string;
  jobCount: number;
}

export interface CostSavingsEstimate {
  totalSavedGB: number;
  estimatedMonthlyCost: number;
  estimatedYearlyCost: number;
  costPerGB: number;
  provider: string;
}

export interface NodePerformance {
  nodeId: string;
  nodeName: string;
  jobCount: number;
  avgBytesPerSecond: number;
  avgSavedPercent: number;
  successRate: number;
}

export interface CodecPerformance {
  codec: string;
  jobCount: number;
  avgSavedPercent: number;
  avgBytesPerSecond: number;
}

export interface AnalyticsSummary {
  period: TimePeriod;
  spaceSavings: SpaceSavingsDataPoint[];
  encodingSpeed: EncodingSpeedDataPoint[];
  costSavings: CostSavingsEstimate;
  nodePerformance: NodePerformance[];
  codecPerformance: CodecPerformance[];
}

@Injectable({
  providedIn: 'root',
})
export class AnalyticsClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/analytics';

  getSpaceSavings(period?: TimePeriod): Observable<SpaceSavingsDataPoint[]> {
    const params: Record<string, string> = {};
    if (period) params['period'] = period;
    return this.http.get<SpaceSavingsDataPoint[]>(`${this.apiUrl}/space-savings`, { params });
  }

  getEncodingSpeed(period?: TimePeriod): Observable<EncodingSpeedDataPoint[]> {
    const params: Record<string, string> = {};
    if (period) params['period'] = period;
    return this.http.get<EncodingSpeedDataPoint[]>(`${this.apiUrl}/encoding-speed`, { params });
  }

  getCostSavings(provider?: string): Observable<CostSavingsEstimate> {
    const params: Record<string, string> = {};
    if (provider) params['provider'] = provider;
    return this.http.get<CostSavingsEstimate>(`${this.apiUrl}/cost-savings`, { params });
  }

  getNodePerformance(period?: TimePeriod): Observable<NodePerformance[]> {
    const params: Record<string, string> = {};
    if (period) params['period'] = period;
    return this.http.get<NodePerformance[]>(`${this.apiUrl}/node-performance`, { params });
  }

  getCodecPerformance(period?: TimePeriod): Observable<CodecPerformance[]> {
    const params: Record<string, string> = {};
    if (period) params['period'] = period;
    return this.http.get<CodecPerformance[]>(`${this.apiUrl}/codec-performance`, { params });
  }

  getSummary(period?: TimePeriod): Observable<AnalyticsSummary> {
    const params: Record<string, string> = {};
    if (period) params['period'] = period;
    return this.http.get<AnalyticsSummary>(`${this.apiUrl}/summary`, { params });
  }
}
