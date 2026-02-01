import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { of } from 'rxjs';
import { delay, switchMap } from 'rxjs/operators';
import { NodesClient } from '../../../core/clients/nodes.client';
import type { NodeCapabilities } from '../../nodes/models/node.model';
import type { RegistrationRequest } from '../../nodes/models/registration-request.model';
import { ContainerType } from '../../nodes/models/registration-request.model';

export interface ApprovalDialogData {
  request: RegistrationRequest;
}

export interface ApprovalDialogResult {
  approved: boolean;
  nodeId: string | null;
  capabilities: NodeCapabilities | null;
}

/**
 * Approval Dialog with Capability Detection
 *
 * Flow:
 * 1. Shows node information and hardware specs
 * 2. User clicks "Approve & Add Node"
 * 3. Backend approves and runs capability detection
 * 4. Dialog shows loading state while waiting for detection
 * 5. Shows capability results (network location, shared storage)
 * 6. User clicks "Finish" to close
 */
@Component({
  selector: 'app-approval-dialog',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule],
  styleUrls: ['./approval-dialog.component.scss'],
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <h2 class="dialog-header__title">{{ dialogTitle() }}</h2>
        @if (!isApproving()) {
          <button class="close-btn" (click)="dialogRef.close()">×</button>
        }
      </div>

      <div class="dialog-body">
        <!-- Step 1: Node Information (before approval) -->
        @if (!isApproving() && !capabilityResults()) {
          <!-- Node Information -->
          <div class="info-section">
            <h3>Node Information</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-item__label">Name:</span>
                <span class="info-item__value">{{ data.request.childNodeName }}</span>
              </div>
              <div class="info-item">
                <span class="info-item__label">IP Address:</span>
                <span class="info-item__value">{{ data.request.ipAddress }}</span>
              </div>
              <div class="info-item">
                <span class="info-item__label">Hostname:</span>
                <span class="info-item__value">{{ data.request.hostname }}</span>
              </div>
              <div class="info-item">
                <span class="info-item__label">Container Type:</span>
                <span class="info-item__value">{{ getContainerTypeLabel(data.request.containerType) }}</span>
              </div>
              <div class="info-item">
                <span class="info-item__label">Version:</span>
                <span class="info-item__value">{{ data.request.childVersion }}</span>
              </div>
              <div class="info-item">
                <span class="info-item__label">Acceleration:</span>
                <span class="info-item__value">{{ data.request.acceleration }}</span>
              </div>
            </div>
          </div>

          <!-- Hardware Specifications -->
          <div class="info-section">
            <h3>Hardware Specifications</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-item__label">CPU:</span>
                <span class="info-item__value">{{ data.request.hardwareSpecs.cpuCores }} cores - {{ data.request.hardwareSpecs.cpuModel }}</span>
              </div>
              <div class="info-item">
                <span class="info-item__label">RAM:</span>
                <span class="info-item__value">{{ data.request.hardwareSpecs.ramGb }} GB</span>
              </div>
              <div class="info-item">
                <span class="info-item__label">Disk:</span>
                <span class="info-item__value">{{ data.request.hardwareSpecs.diskGb }} GB</span>
              </div>
              @if (data.request.hardwareSpecs.gpuModel) {
                <div class="info-item">
                  <span class="info-item__label">GPU:</span>
                  <span class="info-item__value">{{ data.request.hardwareSpecs.gpuModel }}</span>
                </div>
              }
            </div>
          </div>

          <!-- Message from child node -->
          @if (data.request.message) {
            <div class="info-section">
              <h3>Message</h3>
              <p class="message">{{ data.request.message }}</p>
            </div>
          }

          <!-- Note about configuration -->
          <div class="info-section note-section">
            <div class="note-box">
              <fa-icon [icon]="['fas', 'info-circle']" class="note-box__icon"></fa-icon>
              <div>
                <strong class="note-box__title">Node Configuration</strong>
                <p class="note-box__message">After approval, BitBonsai will automatically detect the node's network location and storage capabilities to optimize job routing.</p>
              </div>
            </div>
          </div>
        }

        <!-- Step 2: Approving and detecting capabilities -->
        @if (isApproving() && !capabilityResults()) {
          <div class="capability-detecting">
            <fa-icon [icon]="['fas', 'circle-notch']" class="capability-detecting__spinner-icon fa-spin"></fa-icon>
            <h3 class="capability-detecting__title">Detecting Node Capabilities</h3>
            <p class="capability-detecting__message">{{ detectingMessage() }}</p>
            <div class="detecting-phases">
              <div class="phase">
                <fa-icon [icon]="['fas', 'check-circle']" class="phase__icon" [class.active]="detectingPhase() >= 1"></fa-icon>
                <span class="phase__label">Approving node registration</span>
              </div>
              <div class="phase">
                <fa-icon [icon]="['fas', 'check-circle']" class="phase__icon" [class.active]="detectingPhase() >= 2"></fa-icon>
                <span class="phase__label">Testing network connection</span>
              </div>
              <div class="phase">
                <fa-icon [icon]="['fas', 'check-circle']" class="phase__icon" [class.active]="detectingPhase() >= 3"></fa-icon>
                <span class="phase__label">Scanning for shared storage</span>
              </div>
              <div class="phase">
                <fa-icon [icon]="['fas', 'check-circle']" class="phase__icon" [class.active]="detectingPhase() >= 4"></fa-icon>
                <span class="phase__label">Classifying network location</span>
              </div>
            </div>
          </div>
        }

        <!-- Step 3: Capability Results -->
        @if (capabilityResults()) {
          <div class="capability-results">
            <!-- Summary Banner -->
            <div class="results-banner" [class.optimal]="capabilityResults()!.hasSharedStorage && capabilityResults()!.networkLocation === 'LOCAL'">
              <fa-icon [icon]="['fas', 'check-circle']" class="results-banner__icon"></fa-icon>
              <div>
                <strong class="results-banner__title">{{ getResultsSummary() }}</strong>
                <p class="results-banner__message">{{ capabilityResults()!.reasoning }}</p>
              </div>
            </div>

            <!-- Network Location -->
            <div class="result-section">
              <h3 class="result-section__heading">
                <fa-icon [icon]="['fas', 'network-wired']" class="result-section__icon"></fa-icon>
                Network Location
              </h3>
              <div class="result-value">
                <span class="badge" [class.badge-success]="capabilityResults()!.networkLocation === 'LOCAL'" [class.badge-warning]="capabilityResults()!.networkLocation === 'REMOTE'">
                  {{ capabilityResults()!.networkLocation }}
                </span>
                @if (capabilityResults()!.latencyMs !== null) {
                  <span class="latency">{{ capabilityResults()!.latencyMs }}ms latency</span>
                }
              </div>
            </div>

            <!-- Shared Storage -->
            <div class="result-section">
              <h3 class="result-section__heading">
                <fa-icon [icon]="['fas', 'hdd']" class="result-section__icon"></fa-icon>
                Shared Storage Access
              </h3>
              <div class="result-value">
                @if (capabilityResults()!.hasSharedStorage) {
                  <span class="badge badge-success">Available</span>
                  @if (capabilityResults()!.storageBasePath) {
                    <span class="storage-path">{{ capabilityResults()!.storageBasePath }}</span>
                  }
                } @else {
                  <span class="badge badge-secondary">Not Available</span>
                  <span class="note">Files will be transferred over network</span>
                }
              </div>
            </div>

            <!-- Performance Impact -->
            <div class="info-section note-section">
              <div class="note-box" [class.note-optimal]="capabilityResults()!.hasSharedStorage && capabilityResults()!.networkLocation === 'LOCAL'">
                <fa-icon [icon]="['fas', 'info-circle']" class="note-box__icon"></fa-icon>
                <div>
                  <strong class="note-box__title">{{ getPerformanceTitle() }}</strong>
                  <p class="note-box__message">{{ getPerformanceMessage() }}</p>
                </div>
              </div>
            </div>
          </div>
        }

        <!-- Error State -->
        @if (errorMessage()) {
          <div class="error-section">
            <fa-icon [icon]="['fas', 'exclamation-triangle']" class="error-section__icon"></fa-icon>
            <div>
              <strong class="error-section__title">Error</strong>
              <p class="error-section__message">{{ errorMessage() }}</p>
            </div>
          </div>
        }
      </div>

      <div class="dialog-footer">
        @if (!isApproving() && !capabilityResults()) {
          <button class="btn btn-secondary" (click)="dialogRef.close()">Cancel</button>
          <button class="btn btn-primary" (click)="approve()">
            Approve & Add Node
          </button>
        }
        @if (capabilityResults() || errorMessage()) {
          <button class="btn btn-primary" (click)="finish()">
            Finish
          </button>
        }
      </div>
    </div>
  `,
})
export class ApprovalDialogComponent {
  readonly data: ApprovalDialogData = inject(DIALOG_DATA);
  readonly dialogRef = inject(DialogRef);
  private readonly nodesClient = inject(NodesClient);
  private readonly destroyRef = inject(DestroyRef);

  // Expose enum to template
  readonly ContainerType = ContainerType;

  // Component state
  readonly isApproving = signal(false);
  readonly detectingPhase = signal(0);
  readonly detectingMessage = signal('Approving node...');
  readonly capabilityResults = signal<NodeCapabilities | null>(null);
  readonly errorMessage = signal<string | null>(null);
  private approvedNodeId: string | null = null;

  readonly dialogTitle = signal('Approve Registration Request');

  approve(): void {
    this.isApproving.set(true);
    this.detectingPhase.set(1);
    this.detectingMessage.set('Approving node registration...');
    this.dialogTitle.set('Detecting Node Capabilities');

    // Approve the request (backend will run capability detection)
    this.nodesClient
      .approveRequest(this.data.request.id)
      .pipe(
        // Wait for approval to complete
        delay(500),
        // Extract the approved node ID from response
        switchMap((response: RegistrationRequest) => {
          this.detectingPhase.set(2);
          this.detectingMessage.set('Testing network connection...');

          // Get the node ID from the response
          this.approvedNodeId = response.nodeId || response.id;

          // Wait a bit before fetching capabilities (give backend time to complete detection)
          return of(null).pipe(delay(1000));
        }),
        // Fetch capability test results
        switchMap(() => {
          this.detectingPhase.set(3);
          this.detectingMessage.set('Scanning for shared storage...');

          if (!this.approvedNodeId) {
            throw new Error('No node ID received from approval');
          }

          return this.nodesClient.getNodeCapabilities(this.approvedNodeId);
        }),
        delay(500), // Brief delay for smooth UX
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (results: NodeCapabilities) => {
          this.detectingPhase.set(4);
          this.detectingMessage.set('Complete!');
          this.capabilityResults.set(results);
          this.dialogTitle.set('Node Capabilities Detected');
        },
        error: (err) => {
          console.error('Error during approval/capability detection:', err);
          this.errorMessage.set(
            err?.error?.message || 'Failed to approve node or detect capabilities'
          );
          this.isApproving.set(false);
        },
      });
  }

  finish(): void {
    // Return true to indicate successful approval
    this.dialogRef.close({
      approved: true,
      nodeId: this.approvedNodeId,
      capabilities: this.capabilityResults(),
    });
  }

  getContainerTypeLabel(type: ContainerType): string {
    const labels: Record<ContainerType, string> = {
      [ContainerType.BARE_METAL]: 'Bare Metal',
      [ContainerType.DOCKER]: 'Docker',
      [ContainerType.LXC]: 'LXC Container',
      [ContainerType.VM]: 'Virtual Machine',
      [ContainerType.UNKNOWN]: 'Unknown',
    };
    return labels[type];
  }

  getResultsSummary(): string {
    const results = this.capabilityResults();
    if (!results) return '';

    if (results.hasSharedStorage && results.networkLocation === 'LOCAL') {
      return 'Optimal Configuration Detected';
    } else if (results.networkLocation === 'LOCAL') {
      return 'Local Network Detected';
    } else {
      return 'Remote Network Detected';
    }
  }

  getPerformanceTitle(): string {
    const results = this.capabilityResults();
    if (!results) return '';

    if (results.hasSharedStorage && results.networkLocation === 'LOCAL') {
      return 'Optimal Performance';
    } else if (results.networkLocation === 'LOCAL') {
      return 'Good Performance';
    } else {
      return 'Limited Performance';
    }
  }

  getPerformanceMessage(): string {
    const results = this.capabilityResults();
    if (!results) return '';

    if (results.hasSharedStorage && results.networkLocation === 'LOCAL') {
      return 'This node has direct access to shared storage on the local network. Jobs will use zero-copy file access for maximum performance.';
    } else if (results.networkLocation === 'LOCAL') {
      return 'This node is on the local network. Files will be transferred quickly for encoding jobs.';
    } else {
      return 'This node is on a remote network. File transfers may be slower. Consider using VPN or setting up network shares for better performance.';
    }
  }
}
