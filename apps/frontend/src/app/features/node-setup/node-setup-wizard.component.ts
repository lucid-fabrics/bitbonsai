import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import type { CapabilityTestResult } from '../../core/models/capability-test.model';
import { NodeBo } from '../nodes/bos/node.bo';
import type { RegistrationRequest } from '../nodes/models/registration-request.model';
import { CapabilityResultsComponent } from './components/capability-results/capability-results.component';
import { CapabilityTestComponent } from './components/capability-test/capability-test.component';
import type { DiscoveredNode, HardwareDetection } from './models/discovery.model';
import { PairingStatus } from './models/discovery.model';
import { DiscoveryService } from './services/discovery.service';

/**
 * Pairing Method Selection
 */
enum PairingMethod {
  AutoDiscovery = 'auto-discovery',
  ManualCode = 'manual-code',
}

/**
 * Wizard Steps for Child Node Setup
 */
enum WizardStep {
  Welcome = 0,
  ChooseMethod = 1,
  Scanning = 2,
  ManualCode = 3,
  SelectNode = 4,
  Pairing = 5,
  CapabilityTest = 6,
  CapabilityResults = 7,
  Complete = 8,
}

/**
 * Node Setup Wizard Component
 *
 * Multi-step wizard for setting up a child node to connect to a main node.
 *
 * Flow:
 * 1. Welcome - Introduction and start button
 * 2. Scanning - Animated network scan for main nodes
 * 3. Select Node - Choose from discovered main nodes
 * 4. Pairing - Request connection and wait for approval
 * 5. Complete - Success message and hardware summary
 *
 * Features:
 * - Beautiful animations and transitions
 * - Real-time discovery updates
 * - Pairing status polling
 * - Error handling and retry logic
 * - Responsive design
 */
@Component({
  selector: 'app-node-setup-wizard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FontAwesomeModule,
    CapabilityTestComponent,
    CapabilityResultsComponent,
  ],
  templateUrl: './node-setup-wizard.component.html',
  styleUrls: ['./node-setup-wizard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodeSetupWizardComponent implements OnInit {
  private readonly discoveryService = inject(DiscoveryService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);

  // Expose enums and BOs to template
  readonly WizardStep = WizardStep;
  readonly PairingStatus = PairingStatus;
  readonly PairingMethod = PairingMethod;
  readonly NodeBo = NodeBo;
  readonly Math = Math;

  // Wizard state
  readonly currentStep = signal<WizardStep>(WizardStep.Welcome);
  readonly pairingMethod = signal<PairingMethod | null>(null);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // Scanning state
  readonly isScanning = signal(false);
  readonly discoveredNodes = signal<DiscoveredNode[]>([]);
  readonly scanDuration = signal<number>(0);

  // Selection state
  readonly selectedNodeId = signal<string | null>(null);
  readonly childNodeName = signal<string>('');

  // Manual code entry state
  readonly manualPairingCode = signal<string>('');
  readonly manualMainNodeUrl = signal<string>('');

  // Pairing state
  readonly pairingStatus = signal<PairingStatus | null>(null);
  readonly pairingRequestId = signal<string | null>(null);
  readonly pairingCode = signal<string | null>(null);
  readonly pairingMessage = signal<string | null>(null);
  readonly pairingElapsedSeconds = signal<number>(0);
  private pairingTimerInterval: ReturnType<typeof setInterval> | null = null;

  // Capability test state
  readonly capabilityTestResults = signal<CapabilityTestResult | null>(null);
  readonly approvedNodeId = signal<string | null>(null);

  // Completion state
  readonly hardwareDetection = signal<HardwareDetection | null>(null);
  readonly connectedMainNode = signal<{ id: string; name: string } | null>(null);

  // Computed values
  readonly selectedNode = computed(() => {
    const nodeId = this.selectedNodeId();
    const nodes = this.discoveredNodes();
    return nodes.find((n) => n.nodeId === nodeId) ?? null;
  });

  readonly canProceedToSelection = computed(() => {
    return this.discoveredNodes().length > 0;
  });

  readonly canProceedToPairing = computed(() => {
    const selectedNodeId = this.selectedNodeId();
    const childNodeName = this.childNodeName().trim();
    return selectedNodeId !== null && childNodeName.length >= 3;
  });

  readonly pairingTimeoutProgress = computed(() => {
    const elapsed = this.pairingElapsedSeconds();
    const maxSeconds = 120; // 2 minutes
    return Math.min((elapsed / maxSeconds) * 100, 100);
  });

  /**
   * Component initialization
   * Checks for pending pairing requests and resumes polling if needed
   * Validates the pending request before resuming to avoid stale state
   */
  ngOnInit(): void {
    const pendingRequestId = localStorage.getItem('bitbonsai_pending_pairing_request_id');
    const pendingPairingCode = localStorage.getItem('bitbonsai_pending_pairing_code');
    const pendingMainNodeUrl = localStorage.getItem('bitbonsai_pending_main_node_url');

    if (pendingRequestId && pendingPairingCode && pendingMainNodeUrl) {
      // Validate the pending request before resuming
      this.discoveryService.setMainNodeUrl(pendingMainNodeUrl);

      // Check if the request is still valid (not expired, already approved, or rejected)
      this.http
        .get<RegistrationRequest>(
          `${pendingMainNodeUrl}/api/v1/nodes/registration-requests/${pendingRequestId}`
        )
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (request: RegistrationRequest) => {
            if (request.status === 'PENDING') {
              // Valid pending request - resume polling
              this.currentStep.set(WizardStep.Pairing);
              this.pairingRequestId.set(pendingRequestId);
              this.pairingCode.set(pendingPairingCode);
              this.pairingStatus.set(PairingStatus.WAITING_APPROVAL);

              // Start elapsed timer
              this.pairingTimerInterval = setInterval(() => {
                this.pairingElapsedSeconds.update((s) => s + 1);
              }, 1000);

              // Resume polling
              this.startPollingPairingStatus(pendingRequestId);
            } else {
              // Request already processed or expired - clear stale state
              this.clearPendingPairingState();
            }
          },
          error: () => {
            // Request not found or network error - clear stale state
            this.clearPendingPairingState();
          },
        });
    }
  }

  /**
   * Start the wizard by going to pairing method selection
   */
  startWizard(): void {
    this.currentStep.set(WizardStep.ChooseMethod);
    this.errorMessage.set(null);
  }

  /**
   * Select pairing method and proceed
   */
  selectPairingMethod(method: PairingMethod): void {
    this.pairingMethod.set(method);
    this.errorMessage.set(null);

    if (method === PairingMethod.AutoDiscovery) {
      this.currentStep.set(WizardStep.Scanning);
      this.startNetworkScan();
    } else {
      this.currentStep.set(WizardStep.ManualCode);
    }
  }

  /**
   * Switch to auto-discovery mode from any step
   */
  switchToAutoDiscovery(): void {
    this.pairingMethod.set(PairingMethod.AutoDiscovery);
    this.currentStep.set(WizardStep.Scanning);
    this.errorMessage.set(null);
    this.startNetworkScan();
  }

  /**
   * Switch to manual code entry mode from any step
   */
  switchToManualCode(): void {
    this.pairingMethod.set(PairingMethod.ManualCode);
    this.currentStep.set(WizardStep.ManualCode);
    this.errorMessage.set(null);
  }

  /**
   * Start network scan for main nodes
   */
  private startNetworkScan(): void {
    this.isScanning.set(true);
    this.discoveredNodes.set([]);
    this.scanDuration.set(0);

    const _startTime = Date.now();

    this.discoveryService
      .startScan()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.isScanning.set(false);
          this.discoveredNodes.set(result.nodes);
          this.scanDuration.set(result.scanDurationMs);

          if (result.nodes.length === 0) {
            this.errorMessage.set(
              'No main nodes detected. Make sure your main node is running on the same network.'
            );
          } else {
            // Auto-advance to selection after brief delay
            setTimeout(() => {
              this.currentStep.set(WizardStep.SelectNode);
            }, 1000);
          }
        },
        error: (error) => {
          this.isScanning.set(false);
          this.handleError(error, 'Failed to scan network. Please try again.');
        },
      });
  }

  /**
   * Retry network scan
   */
  retryScan(): void {
    this.errorMessage.set(null);
    this.startNetworkScan();
  }

  /**
   * Proceed with manual pairing code
   */
  proceedWithManualCode(): void {
    const code = this.manualPairingCode().trim();
    const nodeUrl = this.manualMainNodeUrl().trim();

    // Validate inputs
    if (!code || code.length !== 6) {
      this.errorMessage.set('Please enter a valid 6-digit pairing code');
      return;
    }

    if (!nodeUrl) {
      this.errorMessage.set('Please enter the main node URL');
      return;
    }

    // Set node name step - user needs to enter child node name before pairing
    this.currentStep.set(WizardStep.SelectNode);
    this.errorMessage.set(null);
  }

  /**
   * Select a discovered node
   */
  selectNode(nodeId: string): void {
    this.selectedNodeId.set(nodeId);
  }

  /**
   * Proceed to pairing step
   */
  proceedToPairing(): void {
    if (!this.canProceedToPairing()) {
      return;
    }

    this.currentStep.set(WizardStep.Pairing);
    this.initiatePairing();
  }

  /**
   * Initiate pairing with selected main node
   */
  initiatePairing(): void {
    const selectedNodeId = this.selectedNodeId();
    const selectedNode = this.selectedNode();
    const childNodeName = this.childNodeName().trim();

    if (!selectedNodeId || !childNodeName || !selectedNode) {
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.pairingElapsedSeconds.set(0);

    // Build main node URL for polling
    const mainNodeUrl = `http://${selectedNode.ipAddress}:${selectedNode.apiPort}`;

    // Start elapsed time timer
    this.pairingTimerInterval = setInterval(() => {
      this.pairingElapsedSeconds.update((s) => s + 1);
    }, 1000);

    this.discoveryService
      .initiatePairing(
        {
          mainNodeId: selectedNodeId,
          childNodeName,
        },
        mainNodeUrl
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.isLoading.set(false);
          this.pairingStatus.set(response.status);
          this.pairingCode.set(response.pairingCode ?? null);
          this.pairingMessage.set(response.message ?? null);
          this.pairingRequestId.set(response.requestId ?? null);

          // Handle immediate approval or rejection
          if (response.status === PairingStatus.APPROVED) {
            this.handlePairingApproved(response);
          } else if (response.status === PairingStatus.REJECTED) {
            this.handlePairingRejected(response);
          } else if (response.status === PairingStatus.ERROR) {
            this.handlePairingError(response);
          } else if (response.status === PairingStatus.WAITING_APPROVAL && response.requestId) {
            // Store pairing info to localStorage for persistence across refreshes
            localStorage.setItem('bitbonsai_pending_pairing_request_id', response.requestId);
            localStorage.setItem('bitbonsai_pending_pairing_code', response.pairingCode || '');
            localStorage.setItem('bitbonsai_pending_main_node_url', mainNodeUrl);

            // Start polling for approval
            this.startPollingPairingStatus(response.requestId);
          }
        },
        error: (error) => {
          this.isLoading.set(false);
          this.stopPairingTimer();
          this.handleError(error, 'Failed to initiate pairing. Please try again.');
        },
      });
  }

  /**
   * Handle successful pairing approval
   * NEW: Transitions to capability testing instead of completing immediately
   */
  private handlePairingApproved(response: {
    connectionToken?: string;
    mainNodeInfo?: { id: string; name: string };
    childNodeId?: string;
  }): void {
    this.stopPairingTimer();
    this.clearPendingPairingState();

    if (response.connectionToken && response.mainNodeInfo) {
      this.connectedMainNode.set(response.mainNodeInfo);

      // Store the approved node ID for capability testing
      if (response.childNodeId) {
        this.approvedNodeId.set(response.childNodeId);
      }

      // Complete setup (save connection token and mark backend setup as complete)
      this.discoveryService
        .completeSetup(response.connectionToken, response.mainNodeInfo)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            // Transition to capability testing instead of going to Complete
            if (this.approvedNodeId()) {
              this.currentStep.set(WizardStep.CapabilityTest);
            } else {
              // Fallback to old behavior if no node ID
              this.currentStep.set(WizardStep.Complete);
            }
          },
          error: (error) => {
            // If setup finalization fails, show error
            this.handleError(error, 'Failed to finalize setup. Please refresh and try again.');
          },
        });
    } else {
      // Fallback behavior
      this.discoveryService
        .getHardwareDetection()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (hardware) => {
            this.hardwareDetection.set(hardware);
            this.currentStep.set(WizardStep.Complete);
          },
          error: () => {
            // Even if hardware detection fails, proceed to complete
            this.currentStep.set(WizardStep.Complete);
          },
        });
    }
  }

  /**
   * Handle pairing rejection
   */
  private handlePairingRejected(response: { message?: string }): void {
    this.stopPairingTimer();
    this.clearPendingPairingState();
    this.errorMessage.set(
      response.message || 'Connection was rejected by the main node. Please try again.'
    );
  }

  /**
   * Handle pairing error
   */
  private handlePairingError(response: { message?: string }): void {
    this.stopPairingTimer();
    this.errorMessage.set(
      response.message || 'An error occurred during pairing. Please try again.'
    );
  }

  /**
   * Stop pairing timer
   */
  private stopPairingTimer(): void {
    if (this.pairingTimerInterval) {
      clearInterval(this.pairingTimerInterval);
      this.pairingTimerInterval = null;
    }
  }

  /**
   * Start polling for pairing status
   */
  private startPollingPairingStatus(requestId: string): void {
    this.discoveryService
      .pollPairingStatus(requestId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.pairingStatus.set(response.status);

          // Handle status changes
          if (response.status === PairingStatus.APPROVED) {
            this.handlePairingApproved(response);
          } else if (response.status === PairingStatus.REJECTED) {
            this.handlePairingRejected(response);
          } else if (response.status === PairingStatus.TIMEOUT) {
            this.stopPairingTimer();
            this.errorMessage.set(
              'Pairing request timed out. Please try again or contact the main node administrator.'
            );
          }
        },
        error: (error) => {
          this.stopPairingTimer();
          this.handleError(error, 'Error checking pairing status. Please try again.');
        },
      });
  }

  /**
   * Clear pending pairing state from localStorage
   */
  private clearPendingPairingState(): void {
    localStorage.removeItem('bitbonsai_pending_pairing_request_id');
    localStorage.removeItem('bitbonsai_pending_pairing_code');
    localStorage.removeItem('bitbonsai_pending_main_node_url');
  }

  /**
   * Go back to previous step
   */
  goBack(): void {
    this.errorMessage.set(null);

    const current = this.currentStep();

    if (current === WizardStep.Scanning || current === WizardStep.ManualCode) {
      this.currentStep.set(WizardStep.ChooseMethod);
    } else if (current === WizardStep.SelectNode) {
      // Go back based on pairing method
      if (this.pairingMethod() === PairingMethod.AutoDiscovery) {
        this.currentStep.set(WizardStep.Scanning);
        this.startNetworkScan();
      } else {
        this.currentStep.set(WizardStep.ManualCode);
      }
    } else if (current === WizardStep.Pairing) {
      this.stopPairingTimer();
      this.clearPendingPairingState();
      this.currentStep.set(WizardStep.SelectNode);
    }
  }

  /**
   * Handle capability test completion
   * Transitions to results screen
   */
  handleCapabilityTestComplete(results: CapabilityTestResult): void {
    this.capabilityTestResults.set(results);
    this.currentStep.set(WizardStep.CapabilityResults);
  }

  /**
   * Handle capability results back button
   */
  handleCapabilityResultsBack(): void {
    this.currentStep.set(WizardStep.CapabilityTest);
  }

  /**
   * Handle capability results complete
   * Finalizes setup and proceeds to completion screen
   */
  handleCapabilityResultsComplete(config: { maxWorkers: number; cpuLimit: number }): void {
    const mainNodeUrl = this.discoveryService.getMainNodeUrl();
    const nodeId = this.approvedNodeId();

    if (!mainNodeUrl || !nodeId) {
      this.errorMessage.set('Configuration save failed: missing connection information');
      return;
    }

    // Save maxWorkers and cpuLimit to the node via MAIN node's backend
    const updateUrl = `${mainNodeUrl}/api/v1/nodes/${nodeId}`;

    this.http
      .patch(updateUrl, {
        maxWorkers: config.maxWorkers,
        cpuLimit: config.cpuLimit,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // Fetch hardware detection for completion screen
          this.discoveryService
            .getHardwareDetection()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (hardware) => {
                this.hardwareDetection.set(hardware);
                this.currentStep.set(WizardStep.Complete);
              },
              error: () => {
                // Even if hardware detection fails, proceed to complete
                this.currentStep.set(WizardStep.Complete);
              },
            });
        },
        error: (err) => {
          this.errorMessage.set(
            `Failed to save configuration: ${err?.error?.message || err?.message || 'Unknown error'}`
          );
        },
      });
  }

  /**
   * Complete wizard and navigate to dashboard
   */
  completeWizard(): void {
    this.router.navigate(['/queue']);
  }

  /**
   * Generic error handler
   */
  private handleError(error: unknown, defaultMessage: string): void {
    if (error && typeof error === 'object' && 'status' in error) {
      const httpError = error as { status: number; error?: { message?: string } };

      if (httpError.status === 0) {
        this.errorMessage.set('Unable to connect to server. Please check your network connection.');
      } else if (httpError.status >= 500) {
        this.errorMessage.set('Server error. Please try again later.');
      } else if (httpError.error?.message) {
        this.errorMessage.set(httpError.error.message);
      } else {
        this.errorMessage.set(defaultMessage);
      }
    } else {
      this.errorMessage.set(defaultMessage);
    }
  }

  /**
   * Cleanup on component destroy
   */
  ngOnDestroy(): void {
    this.stopPairingTimer();
    this.discoveryService.reset();
  }
}
