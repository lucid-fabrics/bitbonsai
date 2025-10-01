import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { Node } from '../models/node.model';

@Injectable({
  providedIn: 'root',
})
export class NodesApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/nodes';

  /**
   * Get all nodes
   */
  getNodes(): Observable<Node[]> {
    return this.http.get<Node[]>(this.apiUrl);
  }

  /**
   * Get a specific node by ID
   */
  getNode(id: string): Observable<Node> {
    return this.http.get<Node>(`${this.apiUrl}/${id}`);
  }
}
