import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { ActivateLicense, License } from '../models/license.model';

@Injectable({
  providedIn: 'root',
})
export class LicenseService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/licenses`;

  getCurrentLicense(): Observable<License> {
    return this.http.get<License>(`${this.apiUrl}/current`);
  }

  activateLicense(activateDto: ActivateLicense): Observable<License> {
    return this.http.post<License>(`${this.apiUrl}/activate`, activateDto);
  }
}
