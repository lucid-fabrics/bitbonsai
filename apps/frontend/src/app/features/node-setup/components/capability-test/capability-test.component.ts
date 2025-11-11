import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  EventEmitter,
  Input,
  inject,
  OnInit,
  Output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import type {
  CapabilityTestProgress,
  CapabilityTestResult,
  TestStatus,
} from '../../../../core/models/capability-test.model';
import { CapabilityTestService } from '../../../../core/services/capability-test.service';

/**
 * Capability Test Component
 *
 * Displays real-time capability detection progress with:
 * - Animated progress bar
 * - 4 test phases with status icons
 * - Auto-transition to results when complete
 */
@Component({
  selector: 'app-capability-test',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule],
  template: `
    <div class="capability-test-container">
      <!-- Progress Header -->
      <div class="test-header">
        <h2>Detecting Node Capabilities</h2>
        <p class="test-subtitle">Running comprehensive compatibility tests...</p>
      </div>

      <!-- Progress Bar -->
      <div class="progress-bar-container">
        <div class="progress-bar-track">
          <div
            class="progress-bar-fill"
            [style.width.%]="progress()"
            [class.complete]="isComplete()"
          ></div>
        </div>
        <div class="progress-text">{{ progress() }}%</div>
      </div>

      <!-- Test Phases -->
      <div class="test-phases">
        <!-- Phase 1: Network Connection -->
        <div class="test-phase" [class.active]="currentPhase() >= 1" [class.complete]="currentPhase() > 1">
          <div class="phase-icon">
            @if (currentPhase() < 1) {
              <i class="far fa-circle"></i>
            } @else if (currentPhase() === 1) {
              <i class="fas fa-spinner fa-spin"></i>
            } @else {
              <i class="fas fa-check-circle text-success"></i>
            }
          </div>
          <div class="phase-content">
            <div class="phase-title">Network Connection</div>
            <div class="phase-description">Measuring latency and connectivity</div>
          </div>
        </div>

        <!-- Phase 2: Shared Storage -->
        <div class="test-phase" [class.active]="currentPhase() >= 2" [class.complete]="currentPhase() > 2">
          <div class="phase-icon">
            @if (currentPhase() < 2) {
              <i class="far fa-circle"></i>
            } @else if (currentPhase() === 2) {
              <i class="fas fa-spinner fa-spin"></i>
            } @else {
              <i class="fas fa-check-circle text-success"></i>
            }
          </div>
          <div class="phase-content">
            <div class="phase-title">Shared Storage Access</div>
            <div class="phase-description">Testing file system access</div>
          </div>
        </div>

        <!-- Phase 3: Hardware Detection -->
        <div class="test-phase" [class.active]="currentPhase() >= 3" [class.complete]="currentPhase() > 3">
          <div class="phase-icon">
            @if (currentPhase() < 3) {
              <i class="far fa-circle"></i>
            } @else if (currentPhase() === 3) {
              <i class="fas fa-spinner fa-spin"></i>
            } @else {
              <i class="fas fa-check-circle text-success"></i>
            }
          </div>
          <div class="phase-content">
            <div class="phase-title">Hardware Detection</div>
            <div class="phase-description">Detecting CPU, RAM, and GPU</div>
          </div>
        </div>

        <!-- Phase 4: Network Type -->
        <div class="test-phase" [class.active]="currentPhase() >= 4" [class.complete]="currentPhase() > 4">
          <div class="phase-icon">
            @if (currentPhase() < 4) {
              <i class="far fa-circle"></i>
            } @else if (currentPhase() === 4) {
              <i class="fas fa-spinner fa-spin"></i>
            } @else {
              <i class="fas fa-check-circle text-success"></i>
            }
          </div>
          <div class="phase-content">
            <div class="phase-title">Network Type Classification</div>
            <div class="phase-description">Determining LOCAL or REMOTE</div>
          </div>
        </div>
      </div>

      <!-- Current Test Message -->
      <div class="current-test-message">
        @if (!isComplete()) {
          <i class="fas fa-sync fa-spin"></i>
          <span>{{ currentTest() }}</span>
        } @else {
          <i class="fas fa-check-circle text-success"></i>
          <span>All tests complete!</span>
        }
      </div>

      <!-- Error Message -->
      @if (errorMessage()) {
        <div class="error-message">
          <i class="fas fa-exclamation-triangle"></i>
          <span>{{ errorMessage() }}</span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .capability-test-container {
        max-width: 600px;
        margin: 0 auto;
        padding: 2rem;
      }

      .test-header {
        text-align: center;
        margin-bottom: 2rem;
      }

      .test-header h2 {
        font-size: 1.75rem;
        font-weight: 600;
        color: #1f2937;
        margin-bottom: 0.5rem;
      }

      .test-subtitle {
        font-size: 0.95rem;
        color: #6b7280;
        margin: 0;
      }

      .progress-bar-container {
        margin-bottom: 2.5rem;
        position: relative;
      }

      .progress-bar-track {
        height: 12px;
        background-color: #e5e7eb;
        border-radius: 9999px;
        overflow: hidden;
      }

      .progress-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #3b82f6, #2563eb);
        border-radius: 9999px;
        transition: width 0.3s ease-in-out;
      }

      .progress-bar-fill.complete {
        background: linear-gradient(90deg, #10b981, #059669);
      }

      .progress-text {
        text-align: center;
        margin-top: 0.5rem;
        font-size: 0.875rem;
        font-weight: 600;
        color: #4b5563;
      }

      .test-phases {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        margin-bottom: 2rem;
      }

      .test-phase {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        padding: 1rem;
        border-radius: 8px;
        background-color: #f9fafb;
        border: 1px solid #e5e7eb;
        transition: all 0.3s ease-in-out;
      }

      .test-phase.active {
        background-color: #eff6ff;
        border-color: #3b82f6;
      }

      .test-phase.complete {
        background-color: #f0fdf4;
        border-color: #10b981;
      }

      .phase-icon {
        font-size: 1.5rem;
        width: 2rem;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af;
      }

      .test-phase.active .phase-icon {
        color: #3b82f6;
      }

      .test-phase.complete .phase-icon {
        color: #10b981;
      }

      .phase-content {
        flex: 1;
      }

      .phase-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: #1f2937;
        margin-bottom: 0.25rem;
      }

      .phase-description {
        font-size: 0.85rem;
        color: #6b7280;
      }

      .current-test-message {
        text-align: center;
        padding: 1rem;
        background-color: #f0f9ff;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        font-size: 0.95rem;
        color: #0369a1;
        font-weight: 500;
      }

      .current-test-message i {
        font-size: 1.25rem;
      }

      .error-message {
        margin-top: 1rem;
        padding: 1rem;
        background-color: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        color: #991b1b;
        font-size: 0.9rem;
      }

      .error-message i {
        font-size: 1.25rem;
      }

      .text-success {
        color: #10b981;
      }

      @keyframes pulse {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }

      .fa-spin {
        animation: fa-spin 1s infinite linear;
      }

      @keyframes fa-spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapabilityTestComponent implements OnInit {
  private readonly capabilityTestService = inject(CapabilityTestService);
  private readonly destroyRef = inject(DestroyRef);

  @Input({ required: true }) nodeId!: string;
  @Output() testComplete = new EventEmitter<CapabilityTestResult>();

  // Component state
  readonly currentPhase = signal(0);
  readonly progress = signal(0);
  readonly currentTest = signal('Initializing...');
  readonly isComplete = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly testResults = signal<CapabilityTestResult | null>(null);

  ngOnInit(): void {
    this.startCapabilityTest();
  }

  /**
   * Start the capability test
   */
  private startCapabilityTest(): void {
    this.capabilityTestService
      .startTest(this.nodeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (progressUpdate: CapabilityTestProgress) => {
          this.currentPhase.set(progressUpdate.currentPhase);
          this.progress.set(progressUpdate.progress);
          this.currentTest.set(progressUpdate.currentTest);
          this.errorMessage.set(progressUpdate.error);

          if (progressUpdate.isComplete && progressUpdate.results) {
            this.isComplete.set(true);
            this.testResults.set(progressUpdate.results);

            // Emit completion event after brief delay
            setTimeout(() => {
              this.testComplete.emit(progressUpdate.results!);
            }, 1000);
          }
        },
        error: (error) => {
          this.errorMessage.set(error?.message || 'Test failed unexpectedly');
        },
      });
  }
}
