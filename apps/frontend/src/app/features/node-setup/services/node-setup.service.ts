import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { switchMap } from 'rxjs';
import type { RegistrationRequest } from '../../nodes/models/registration-request.model';
import type {
  DiscoveredNode,
  HardwareDetection,
  PairingRequest,
  PairingResponse,
  ScanResult,
} from '../models/discovery.model';
import { DiscoveryService } from './discovery.service';

const STORAGE_KEY_REQUEST_ID = 'bitbonsai_pending_pairing_request_id';
const STORAGE_KEY_PAIRING_CODE = 'bitbonsai_pending_pairing_code';
const STORAGE_KEY_MAIN_NODE_URL = 'bitbonsai_pending_main_node_url';

export interface PendingPairingState {
  requestId: string;
  pairingCode: string;
  mainNodeUrl: string;
}

/**
 * Node Setup Service
 *
 * Encapsulates all orchestration logic for the node setup wizard:
 * - Network scanning
 * - Pairing initiation and status polling
 * - localStorage persistence for pending pairing state
 * - Setup completion (token storage + backend initialization)
 * - Node configuration updates
 * - Hardware detection
 */
@Injectable({
  providedIn: 'root',
})
export class NodeSetupService {
  private readonly discoveryService = inject(DiscoveryService);

  // ─── Network Scanning ───────────────────────────────────────────────────────

  startScan(): Observable<ScanResult> {
    return this.discoveryService.startScan();
  }

  // ─── Pairing ─────────────────────────────────────────────────────────────────

  initiatePairing(request: PairingRequest, mainNodeUrl: string): Observable<PairingResponse> {
    return this.discoveryService.initiatePairing(request, mainNodeUrl);
  }

  pollPairingStatus(requestId: string): Observable<PairingResponse> {
    return this.discoveryService.pollPairingStatus(requestId);
  }

  getRegistrationRequest(mainNodeUrl: string, requestId: string): Observable<RegistrationRequest> {
    return this.discoveryService.getRegistrationRequest(mainNodeUrl, requestId);
  }

  setMainNodeUrl(url: string): void {
    this.discoveryService.setMainNodeUrl(url);
  }

  getMainNodeUrl(): string | null {
    return this.discoveryService.getMainNodeUrl();
  }

  // ─── Setup Completion ─────────────────────────────────────────────────────────

  /**
   * Completes setup by saving connection token and initializing backend.
   * Then transitions to capability testing by fetching hardware detection.
   */
  completeSetup(
    connectionToken: string,
    mainNodeInfo: { id: string; name: string }
  ): Observable<void> {
    return this.discoveryService.completeSetup(connectionToken, mainNodeInfo);
  }

  updateNodeConfig(
    mainNodeUrl: string,
    nodeId: string,
    config: { maxWorkers: number; cpuLimit: number }
  ): Observable<unknown> {
    return this.discoveryService.updateNodeConfig(mainNodeUrl, nodeId, config);
  }

  getHardwareDetection(): Observable<HardwareDetection> {
    return this.discoveryService.getHardwareDetection();
  }

  /**
   * Saves node config then fetches hardware detection in sequence.
   */
  finalizeCapabilityConfig(
    mainNodeUrl: string,
    nodeId: string,
    config: { maxWorkers: number; cpuLimit: number }
  ): Observable<HardwareDetection> {
    return this.discoveryService
      .updateNodeConfig(mainNodeUrl, nodeId, config)
      .pipe(switchMap(() => this.discoveryService.getHardwareDetection()));
  }

  // ─── localStorage Persistence ─────────────────────────────────────────────────

  savePendingPairingState(requestId: string, pairingCode: string, mainNodeUrl: string): void {
    localStorage.setItem(STORAGE_KEY_REQUEST_ID, requestId);
    localStorage.setItem(STORAGE_KEY_PAIRING_CODE, pairingCode);
    localStorage.setItem(STORAGE_KEY_MAIN_NODE_URL, mainNodeUrl);
  }

  loadPendingPairingState(): PendingPairingState | null {
    const requestId = localStorage.getItem(STORAGE_KEY_REQUEST_ID);
    const pairingCode = localStorage.getItem(STORAGE_KEY_PAIRING_CODE);
    const mainNodeUrl = localStorage.getItem(STORAGE_KEY_MAIN_NODE_URL);

    if (requestId && pairingCode && mainNodeUrl) {
      return { requestId, pairingCode, mainNodeUrl };
    }
    return null;
  }

  clearPendingPairingState(): void {
    localStorage.removeItem(STORAGE_KEY_REQUEST_ID);
    localStorage.removeItem(STORAGE_KEY_PAIRING_CODE);
    localStorage.removeItem(STORAGE_KEY_MAIN_NODE_URL);
  }

  // ─── Reset ────────────────────────────────────────────────────────────────────

  reset(): void {
    this.discoveryService.reset();
  }

  buildMainNodeUrl(node: DiscoveredNode): string {
    return `http://${node.ipAddress}:${node.apiPort}`;
  }
}
