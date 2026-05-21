import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface DirectoryInfo {
  name: string;
  path: string;
  isAccessible: boolean;
}

export interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryInfo[];
}

@Injectable({ providedIn: 'root' })
export class FileBrowserService {
  private readonly http = inject(HttpClient);

  browse(apiUrl: string, path: string): Observable<BrowseResult> {
    return this.http.get<BrowseResult>(`${apiUrl}/filesystem/browse`, {
      params: { path },
    });
  }
}
