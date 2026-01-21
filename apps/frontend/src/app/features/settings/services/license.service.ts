import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type {
  ActivateLicense,
  License,
  LicenseCapabilities,
  LicenseTierInfo,
  LookupLicenseResponse,
  StripeCheckoutResponse,
  StripePlan,
  StripeStatus,
} from '../models/license.model';

@Injectable({
  providedIn: 'root',
})
export class LicenseService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/licenses`;
  private readonly stripeUrl = `${environment.licenseApiUrl}/stripe`; // Use license-api for Stripe

  // License endpoints
  getCurrentLicense(): Observable<License> {
    return this.http.get<License>(`${this.apiUrl}/current`);
  }

  getCapabilities(): Observable<LicenseCapabilities> {
    return this.http.get<LicenseCapabilities>(`${this.apiUrl}/capabilities`);
  }

  getAvailableTiers(): Observable<{ tiers: LicenseTierInfo[] }> {
    return this.http.get<{ tiers: LicenseTierInfo[] }>(`${this.apiUrl}/tiers`);
  }

  activateLicense(activateDto: ActivateLicense): Observable<License> {
    return this.http.post<License>(`${this.apiUrl}/activate`, activateDto);
  }

  lookupLicense(email: string): Observable<LookupLicenseResponse> {
    return this.http.post<LookupLicenseResponse>(`${this.apiUrl}/lookup`, { email });
  }

  // Stripe endpoints
  getStripeStatus(): Observable<StripeStatus> {
    return this.http.get<StripeStatus>(`${this.stripeUrl}/status`);
  }

  getStripePlans(): Observable<{ plans: StripePlan[]; configured: boolean }> {
    return this.http.get<{ plans: StripePlan[]; configured: boolean }>(`${this.stripeUrl}/plans`);
  }

  createStripeCheckout(email: string, priceId: string): Observable<StripeCheckoutResponse> {
    return this.http.post<StripeCheckoutResponse>(`${this.stripeUrl}/checkout`, {
      email,
      priceId,
      successUrl: `${window.location.origin}/settings?tab=license&stripe=success`,
      cancelUrl: `${window.location.origin}/settings?tab=license`,
    });
  }

  getStripePortalUrl(customerId: string): Observable<{ url: string }> {
    return this.http.post<{ url: string }>(`${this.stripeUrl}/portal`, { customerId });
  }
}
