import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import type { CurrentNode } from '../models/node.model';

/**
 * Node Service
 *
 * Manages current node information and provides role-based access control.
 * Caches node information to avoid repeated API calls.
 */
@Injectable({
  providedIn: 'root',
})
export class NodeService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/nodes`;

  /**
   * Cached current node information (reactive signal)
   */
  private readonly currentNode = signal<CurrentNode | null>(null);

  /**
   * Cached MAIN node information (reactive signal)
   * Used by LINKED nodes to display which MAIN node they're connected to
   */
  private readonly mainNode = signal<CurrentNode | null>(null);

  /**
   * Fetch current node information from the API
   *
   * Caches the result in a signal for reactive access.
   * Call this once during app initialization.
   */
  getCurrentNode(): Observable<CurrentNode> {
    return this.http.get<CurrentNode>(`${this.apiUrl}/current`).pipe(
      tap((node) => {
        this.currentNode.set(node);
      })
    );
  }

  /**
   * Fetch MAIN node information from the API
   *
   * This is used by LINKED nodes to display information about
   * the MAIN node they're connected to.
   */
  getMainNode(): Observable<void> {
    return this.http.get<CurrentNode[]>(this.apiUrl).pipe(
      tap((nodes) => {
        const main = nodes.find((n) => n.role === 'MAIN');
        if (main) {
          this.mainNode.set(main);
        }
      }),
      map(() => undefined)
    );
  }

  /**
   * Get cached current node (synchronous)
   *
   * Returns null if getCurrentNode() hasn't been called yet.
   */
  getCachedNode(): CurrentNode | null {
    return this.currentNode();
  }

  /**
   * Check if current node is MAIN node
   *
   * @returns true if node is MAIN, false otherwise
   */
  isMainNode(): boolean {
    return this.currentNode()?.role === 'MAIN';
  }

  /**
   * Check if current node is LINKED node (child node)
   *
   * @returns true if node is LINKED, false otherwise
   */
  isLinkedNode(): boolean {
    return this.currentNode()?.role === 'LINKED';
  }

  /**
   * Get reactive signal for current node
   *
   * Use this in components to reactively access node information.
   */
  getNodeSignal() {
    return this.currentNode.asReadonly();
  }

  /**
   * Get reactive signal for MAIN node
   *
   * Use this in components to reactively access MAIN node information.
   */
  getMainNodeSignal() {
    return this.mainNode.asReadonly();
  }
}
