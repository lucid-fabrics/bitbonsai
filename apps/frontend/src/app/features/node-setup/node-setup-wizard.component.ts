import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { NodeBo } from '../nodes/bos/node.bo';
import type { DiscoveredNode, HardwareDetection } from './models/discovery.model';
import { PairingStatus } from './models/discovery.model';
import { DiscoveryService } from './services/discovery.service';

/**
 * Wizard Steps for Child Node Setup
 */
enum WizardStep {
  Welcome = 0,
  Scanning = 1,
  SelectNode = 2,
  Pairing = 3,
  Complete = 4,
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
  imports: [CommonModule, FormsModule, FontAwesomeModule],
  templateUrl: './node-setup-wizard.component.html',
  styleUrls: ['./node-setup-wizard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodeSetupWizardComponent {
  private readonly discoveryService = inject(DiscoveryService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Expose enums and BOs to template
  readonly WizardStep = WizardStep;
  readonly PairingStatus = PairingStatus;
  readonly NodeBo = NodeBo;

  // Wizard state
  readonly currentStep = signal<WizardStep>(WizardStep.Welcome);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // Scanning state
  readonly isScanning = signal(false);
  readonly discoveredNodes = signal<DiscoveredNode[]>([]);
  readonly scanDuration = signal<number>(0);

  // Selection state
  readonly selectedNodeId = signal<string | null>(null);
  readonly childNodeName = signal<string>('');

  // Pairing state
  readonly pairingStatus = signal<PairingStatus | null>(null);
  readonly pairingCode = signal<string | null>(null);
  readonly pairingMessage = signal<string | null>(null);
  readonly pairingElapsedSeconds = signal<number>(0);
  private pairingTimerInterval: ReturnType<typeof setInterval> | null = null;

  // Completion state
  readonly hardwareDetection = signal<HardwareDetection | null>(null);
  readonly connectedMainNode = signal<{ id: string; name: string } | null>(null);

  // Computed values
  readonly selectedNode = computed(() => {
    const nodeId = this.selectedNodeId();
    const nodes = this.discoveredNodes();
    return nodes.find((n) => n.id === nodeId) ?? null;
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
   * Start the wizard by beginning network scan
   */
  startWizard(): void {
    this.currentStep.set(WizardStep.Scanning);
    this.errorMessage.set(null);
    this.startNetworkScan();
  }

  /**
   * Start network scan for main nodes
   */
  private startNetworkScan(): void {
    this.isScanning.set(true);
    this.discoveredNodes.set([]);
    this.scanDuration.set(0);

    const startTime = Date.now();

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
    const childNodeName = this.childNodeName().trim();

    if (!selectedNodeId || !childNodeName) {
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.pairingElapsedSeconds.set(0);

    // Start elapsed time timer
    this.pairingTimerInterval = setInterval(() => {
      this.pairingElapsedSeconds.update((s) => s + 1);
    }, 1000);

    this.discoveryService
      .initiatePairing({
        mainNodeId: selectedNodeId,
        childNodeName,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.isLoading.set(false);
          this.pairingStatus.set(response.status);
          this.pairingCode.set(response.pairingCode ?? null);
          this.pairingMessage.set(response.message ?? null);

          // Handle immediate approval or rejection
          if (response.status === PairingStatus.APPROVED) {
            this.handlePairingApproved(response);
          } else if (response.status === PairingStatus.REJECTED) {
            this.handlePairingRejected(response);
          } else if (response.status === PairingStatus.ERROR) {
            this.handlePairingError(response);
          }
          // Otherwise, pairing is waiting for approval - user will see status
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
   */
  private handlePairingApproved(response: {
    connectionToken?: string;
    mainNodeInfo?: { id: string; name: string };
  }): void {
    this.stopPairingTimer();

    if (response.connectionToken && response.mainNodeInfo) {
      this.discoveryService.completeSetup(response.connectionToken, response.mainNodeInfo);
      this.connectedMainNode.set(response.mainNodeInfo);
    }

    // Fetch hardware detection
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

  /**
   * Handle pairing rejection
   */
  private handlePairingRejected(response: { message?: string }): void {
    this.stopPairingTimer();
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
   * Go back to previous step
   */
  goBack(): void {
    this.errorMessage.set(null);

    if (this.currentStep() === WizardStep.SelectNode) {
      this.currentStep.set(WizardStep.Scanning);
      this.startNetworkScan();
    } else if (this.currentStep() === WizardStep.Pairing) {
      this.stopPairingTimer();
      this.currentStep.set(WizardStep.SelectNode);
    }
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
