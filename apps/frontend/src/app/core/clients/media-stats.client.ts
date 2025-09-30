import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { MediaStatsModel } from '../models/media-stats.model';

@Injectable({ providedIn: 'root' })
export class MediaStatsClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1';

  getStats(): Observable<MediaStatsModel> {
    return this.http.get<MediaStatsModel>(`${this.apiUrl}/media-stats`);
  }

  triggerScan(): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/media-stats/scan`, {});
  }
}
