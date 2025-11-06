import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { BehaviorSubject, interval, switchMap, takeWhile, tap } from 'rxjs';
import type {
  DiscoveredNode,
  HardwareDetection,
  PairingRequest,
  PairingResponse,
  ScanResult,
} from '../models/discovery.model';
import { PairingStatus } from '../models/discovery.model';

/**
 * Discovery Service
 *
 * Manages the child node setup wizard flow:
 * 1. Network scanning for main nodes
 * 2. Pairing with selected main node
 * 3. Hardware detection
 *
 * Follows Angular best practices:
 * - Standalone service with providedIn: 'root'
 * - Uses BehaviorSubject for real-time updates
 * - Proper error handling
 */
@Injectable({
  providedIn: 'root',
})
export class DiscoveryService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/discovery';

  // Real-time scanning state
  private readonly scanningSubject = new BehaviorSubject<boolean>(false);
  public readonly scanning$ = this.scanningSubject.asObservable();

  // Discovered nodes state
  private readonly discoveredNodesSubject = new BehaviorSubject<DiscoveredNode[]>([]);
  public readonly discoveredNodes$ = this.discoveredNodesSubject.asObservable();

  // Pairing state
  private readonly pairingStatusSubject = new BehaviorSubject<PairingStatus | null>(null);
  public readonly pairingStatus$ = this.pairingStatusSubject.asObservable();

  /**
   * Start network scan for BitBonsai main nodes
   *
   * Polls the scan endpoint to get real-time discovery updates.
   * Updates discoveredNodes$ as nodes are found.
   */
  startScan(): Observable<ScanResult> {
    this.scanningSubject.next(true);
    this.discoveredNodesSubject.next([]);

    return this.http.get<ScanResult>(`${this.apiUrl}/scan`).pipe(
      tap((result) => {
        this.discoveredNodesSubject.next(result.nodes);
        this.scanningSubject.next(false);
      })
    );
  }

  /**
   * Stop ongoing scan
   */
  stopScan(): void {
    this.scanningSubject.next(false);
  }

  /**
   * Initiate pairing with a main node
   *
   * Sends pairing request and starts polling for approval status.
   *
   * @param request - Pairing request with main node ID and child node name
   */
  initiatePairing(request: PairingRequest): Observable<PairingResponse> {
    this.pairingStatusSubject.next(PairingStatus.PENDING);

    return this.http.post<PairingResponse>(`${this.apiUrl}/pair`, request).pipe(
      tap((response) => {
        this.pairingStatusSubject.next(response.status);
      })
    );
  }

  /**
   * Poll pairing status until approved, rejected, or timeout
   *
   * Checks pairing status every 2 seconds for up to 2 minutes.
   *
   * @param pairingId - Unique pairing session ID
   */
  pollPairingStatus(pairingId: string): Observable<PairingResponse> {
    let elapsedSeconds = 0;
    const maxWaitSeconds = 120; // 2 minutes
    const pollIntervalSeconds = 2;

    return interval(pollIntervalSeconds * 1000).pipe(
      switchMap(() => this.http.get<PairingResponse>(`${this.apiUrl}/pair/${pairingId}/status`)),
      tap((response) => {
        this.pairingStatusSubject.next(response.status);
        elapsedSeconds += pollIntervalSeconds;
      }),
      takeWhile((response) => {
        // Stop polling if approved, rejected, or timeout
        if (
          response.status === PairingStatus.APPROVED ||
          response.status === PairingStatus.REJECTED ||
          response.status === PairingStatus.ERROR
        ) {
          return false;
        }

        // Stop polling after 2 minutes
        if (elapsedSeconds >= maxWaitSeconds) {
          this.pairingStatusSubject.next(PairingStatus.TIMEOUT);
          return false;
        }

        return true;
      }, true) // Include the final value
    );
  }

  /**
   * Get hardware detection summary
   *
   * Retrieves the detected hardware capabilities of this child node.
   */
  getHardwareDetection(): Observable<HardwareDetection> {
    return this.http.get<HardwareDetection>(`${this.apiUrl}/hardware`);
  }

  /**
   * Complete setup and store connection configuration
   *
   * Saves the connection token and main node info to local storage
   * so the child node can authenticate on subsequent requests.
   *
   * @param connectionToken - JWT token for authenticating with main node
   * @param mainNodeInfo - Information about the connected main node
   */
  completeSetup(connectionToken: string, mainNodeInfo: { id: string; name: string }): void {
    localStorage.setItem('bitbonsai_connection_token', connectionToken);
    localStorage.setItem('bitbonsai_main_node', JSON.stringify(mainNodeInfo));
  }

  /**
   * Reset discovery service state
   *
   * Clears all in-memory state. Used when restarting the wizard.
   */
  reset(): void {
    this.scanningSubject.next(false);
    this.discoveredNodesSubject.next([]);
    this.pairingStatusSubject.next(null);
  }
}
