import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { MediaStatsClient } from '../../../core/clients/media-stats.client';
import { MediaStatsBo } from '../bos/media-stats.bo';

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
