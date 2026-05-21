import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import type { CurrentNode } from '../../features/nodes/models/node.model';

/**
 * Node Service
 *
 * Provides API access for current node information.
 * State is managed in NgRx store (core/+state/current-node).
 */
@Injectable({
  providedIn: 'root',
})
export class NodeService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/nodes`;

  /**
   * Fetch current node information from the API
   */
  getCurrentNode(): Observable<CurrentNode> {
    return this.http.get<CurrentNode>(`${this.apiUrl}/current`);
  }

  /**
   * Fetch MAIN node information from the API
   *
   * This is used by LINKED nodes to display information about
   * the MAIN node they're connected to.
   */
  getMainNode(): Observable<CurrentNode> {
    return this.http.get<CurrentNode[]>(this.apiUrl).pipe(
      map((nodes) => {
        const main = nodes.find((n) => n.role === 'MAIN');
        if (!main) {
          throw new Error('No MAIN node found');
        }
        return main;
      })
    );
  }
}
