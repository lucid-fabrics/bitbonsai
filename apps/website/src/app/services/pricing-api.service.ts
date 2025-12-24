import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PricingTier {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  maxNodes: number;
  maxConcurrentJobs: number;
  priceMonthly: number;
  priceYearly?: number;
  features: string[];
  stripePriceIdMonthly?: string;
  stripePriceIdYearly?: string;
  isActive: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PricingApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.licenseApiUrl}/pricing`;

  getActiveTiers(): Observable<PricingTier[]> {
    return this.http.get<PricingTier[]>(`${this.baseUrl}/active`);
  }
}
