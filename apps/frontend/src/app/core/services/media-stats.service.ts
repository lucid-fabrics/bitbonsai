import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { MediaStatsBo } from '../business-objects/media-stats.bo';
import { MediaStatsClient } from '../clients/media-stats.client';

@Injectable({
  providedIn: 'root',
})
export class MediaStatsService {
  private readonly mediaStatsClient = inject(MediaStatsClient);

  public getMediaStats(): Observable<MediaStatsBo> {
    return this.mediaStatsClient
      .getMediaStats()
      .pipe(map((responseModel) => new MediaStatsBo(responseModel)));
  }

  public triggerScan(): Observable<void> {
    return this.mediaStatsClient.triggerScan();
  }
}
