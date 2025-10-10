import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { OverviewModel } from '../../features/overview/models/overview.model';

@Injectable({
  providedIn: 'root',
})
export class OverviewClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/overview';

  /**
   * Get overview dashboard data from the real backend endpoint
   */
  getOverview(): Observable<OverviewModel> {
    return this.http.get<OverviewModel>(this.apiUrl);
  }
}
