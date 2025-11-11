import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { BehaviorSubject, interval, map, switchMap, takeWhile, tap } from 'rxjs';
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

  // Main node URL for polling (child node polls main node, not itself)
  private mainNodeUrl: string | null = null;

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
   * @param mainNodeUrl - URL of the main node (for polling)
   */
  initiatePairing(request: PairingRequest, mainNodeUrl?: string): Observable<PairingResponse> {
    this.pairingStatusSubject.next(PairingStatus.PENDING);

    // Store main node URL for polling
    if (mainNodeUrl) {
      this.mainNodeUrl = mainNodeUrl;
    }

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
   * IMPORTANT: Polls the MAIN node's API, not the child node's local API.
   *
   * @param pairingId - Unique pairing session ID
   */
  pollPairingStatus(pairingId: string): Observable<PairingResponse> {
    let elapsedSeconds = 0;
    const maxWaitSeconds = 120; // 2 minutes
    const pollIntervalSeconds = 2;

    // Use main node URL if available, otherwise fall back to local API
    const pollUrl = this.mainNodeUrl
      ? `${this.mainNodeUrl}/api/v1/nodes/registration-requests/${pairingId}`
      : `${this.apiUrl}/pair/${pairingId}/status`;

    return interval(pollIntervalSeconds * 1000).pipe(
      switchMap(() => this.http.get<any>(pollUrl)),
      map((response: any): PairingResponse => this.mapToPairingResponse(response)), // Transform to PairingResponse
      tap((pairingResponse: PairingResponse) => {
        this.pairingStatusSubject.next(pairingResponse.status);
        elapsedSeconds += pollIntervalSeconds;
      }),
      takeWhile((pairingResponse: PairingResponse) => {
        // Stop polling if approved, rejected, or timeout
        if (
          pairingResponse.status === PairingStatus.APPROVED ||
          pairingResponse.status === PairingStatus.REJECTED ||
          pairingResponse.status === PairingStatus.ERROR
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
   * Map registration request response to pairing response
   */
  private mapToPairingResponse(registrationRequest: any): PairingResponse {
    if (!registrationRequest || !registrationRequest.status) {
      return {
        status: PairingStatus.ERROR,
        message: 'Invalid response from server',
      };
    }

    switch (registrationRequest.status) {
      case 'PENDING':
        return {
          status: PairingStatus.WAITING_APPROVAL,
          pairingCode: registrationRequest.pairingToken,
          message: 'Waiting for approval from main node',
        };

      case 'APPROVED':
        return {
          status: PairingStatus.APPROVED,
          message: 'Pairing approved successfully',
          connectionToken: registrationRequest.apiKey,
          childNodeId: registrationRequest.childNodeId,
          mainNodeInfo: registrationRequest.mainNode
            ? {
                id: registrationRequest.mainNode.id,
                name: registrationRequest.mainNode.name,
                version: registrationRequest.mainNode.version,
              }
            : {
                id: registrationRequest.mainNodeId,
                name: 'Main Node',
                version: '0.1.0',
              },
        };

      case 'REJECTED':
        return {
          status: PairingStatus.REJECTED,
          message: registrationRequest.rejectionReason || 'Pairing request was rejected',
        };

      case 'EXPIRED':
        return {
          status: PairingStatus.TIMEOUT,
          message: 'Pairing request expired',
        };

      default:
        return {
          status: PairingStatus.ERROR,
          message: `Unknown status: ${registrationRequest.status}`,
        };
    }
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
   * Also marks setup as complete in the backend database.
   *
   * @param connectionToken - JWT token for authenticating with main node
   * @param mainNodeInfo - Information about the connected main node
   * @returns Observable that completes when setup is finalized
   */
  completeSetup(
    connectionToken: string,
    mainNodeInfo: { id: string; name: string }
  ): Observable<void> {
    console.log('[DiscoveryService] Saving connection token and main node info to localStorage');
    localStorage.setItem('bitbonsai_connection_token', connectionToken);
    localStorage.setItem('bitbonsai_main_node', JSON.stringify(mainNodeInfo));

    // Mark setup as complete in the backend for child nodes
    // Child nodes default to allowing local network access without auth
    // since they're typically on the same network for distributed encoding
    const payload = {
      nodeType: 'child',
      allowLocalNetworkWithoutAuth: true,
    };

    console.log('[DiscoveryService] Calling POST /api/v1/setup/initialize with payload:', payload);

    return this.http.post<void>('/api/v1/setup/initialize', payload);
  }

  /**
   * Set main node URL for polling
   *
   * @param url - Main node URL
   */
  setMainNodeUrl(url: string): void {
    this.mainNodeUrl = url;
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
    this.mainNodeUrl = null;
  }
}
