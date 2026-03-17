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
  stripePriceIdMonthly?: string;
  stripePriceIdYearly?: string;
  patreonTierId?: string;
  isActive: boolean;
}

export interface CreateCheckoutDto {
  email: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResponse {
  url: string;
  sessionId: string;
}

@Injectable({
  providedIn: 'root',
})
export class PricingApiService {
  private readonly http = inject(HttpClient);
  private readonly pricingUrl = `${environment.licenseApiUrl}/pricing`;
  private readonly stripeUrl = `${environment.licenseApiUrl}/stripe`;

  getActiveTiers(): Observable<PricingTier[]> {
    return this.http.get<PricingTier[]>(this.pricingUrl);
  }

  createCheckoutSession(dto: CreateCheckoutDto): Observable<CheckoutResponse> {
    return this.http.post<CheckoutResponse>(`${this.stripeUrl}/checkout`, dto);
  }
}
