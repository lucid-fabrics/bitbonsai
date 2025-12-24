import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface RevenueMetrics {
  mrr: number;
  arr: number;
  churnRate: number;
  clv: number;
  activeSubscriptions: number;
  newSubscriptionsThisMonth: number;
  revenueByTier: Record<string, number>;
  subscriptionHealth: {
    healthy: number;
    expiringSoon: number;
    overdue: number;
  };
}

export interface DailyRevenue {
  date: string;
  revenue: number;
  subscriptions: number;
}

export interface TierDistribution {
  tier: string;
  count: number;
  percentage: number;
}

export interface MonthlyChurn {
  month: string;
  churnRate: number;
}

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly baseUrl = environment.licenseApiUrl;

  private getHeaders(): HttpHeaders {
    const apiKey = this.auth.getApiKey();
    let headers = new HttpHeaders({
      'Content-Type': 'application/json',
    });
    if (apiKey) {
      headers = headers.set('x-admin-api-key', apiKey);
    }
    return headers;
  }

  get<T>(endpoint: string): Observable<T> {
    return this.http.get<T>(`${this.baseUrl}${endpoint}`, {
      headers: this.getHeaders(),
    });
  }

  post<T, B = Record<string, unknown>>(endpoint: string, body: B): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${endpoint}`, body, {
      headers: this.getHeaders(),
    });
  }

  patch<T, B = Record<string, unknown>>(endpoint: string, body: B): Observable<T> {
    return this.http.patch<T>(`${this.baseUrl}${endpoint}`, body, {
      headers: this.getHeaders(),
    });
  }

  delete<T>(endpoint: string): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl}${endpoint}`, {
      headers: this.getHeaders(),
    });
  }

  async testAdminAuth(apiKey: string): Promise<void> {
    const headers = new HttpHeaders({
      'x-admin-api-key': apiKey,
    });
    await firstValueFrom(this.http.get(`${this.baseUrl}/analytics/revenue-metrics`, { headers }));
  }

  getRevenueMetrics(): Observable<RevenueMetrics> {
    return this.get<RevenueMetrics>('/analytics/revenue-metrics');
  }

  getDailyRevenue(days = 30): Observable<DailyRevenue[]> {
    return this.get<DailyRevenue[]>(`/analytics/daily-revenue?days=${days}`);
  }

  getTierDistribution(): Observable<TierDistribution[]> {
    return this.get<TierDistribution[]>('/analytics/tier-distribution');
  }

  getMonthlyChurnRate(months = 12): Observable<MonthlyChurn[]> {
    return this.get<MonthlyChurn[]>(`/analytics/monthly-churn?months=${months}`);
  }
}
