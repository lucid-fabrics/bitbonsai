import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { MediaStatsModel } from '../models/media-stats.model';
import { FolderFilesModel } from '../models/file-info.model';

@Injectable({
  providedIn: 'root'
})
export class MediaStatsApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/media-stats';

  getMediaStats(): Observable<MediaStatsModel> {
    return this.http.get<MediaStatsModel>(this.apiUrl);
  }

  triggerScan(): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/scan`, {});
  }

  getFolderFiles(folderName: string, codec?: string): Observable<FolderFilesModel> {
    const options = codec ? { params: { codec } } : {};
    return this.http.get<FolderFilesModel>(`${this.apiUrl}/folders/${folderName}/files`, options);
  }
}
