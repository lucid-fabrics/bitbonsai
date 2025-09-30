import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { MediaStatsClient } from '../clients/media-stats.client';
import { MediaStatsBo } from '../business-objects/media-stats.bo';

@Injectable({
  providedIn: 'root'
})
export class MediaStatsService {
  private readonly mediaStatsClient = inject(MediaStatsClient);

  public getMediaStats(): Observable<MediaStatsBo> {
    return this.mediaStatsClient.getStats().pipe(
      map((responseModel) => new MediaStatsBo(responseModel))
    );
  }

  public triggerScan(): Observable<void> {
    return this.mediaStatsClient.triggerScan();
  }
}
