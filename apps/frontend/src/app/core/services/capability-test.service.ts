import { Injectable, inject } from '@angular/core';
import { catchError, interval, map, Observable, of, switchMap, takeWhile } from 'rxjs';
import { NodesClient } from '../clients/nodes.client';
import type { CapabilityTestProgress, CapabilityTestResult } from '../models/capability-test.model';

/**
 * Capability Test Service
 *
 * Handles capability testing for nodes during pairing.
 * Manages test execution and progress polling.
 */
@Injectable({
  providedIn: 'root',
})
export class CapabilityTestService {
  private readonly nodesClient = inject(NodesClient);

  /**
   * Start capability test and poll for results
   *
   * This simulates a multi-phase test with animated progress:
   * 1. Network Connection Test (0-25%)
   * 2. Shared Storage Test (25-50%)
   * 3. Hardware Detection (50-75%)
   * 4. Network Type Classification (75-100%)
   *
   * @param nodeId - Node ID
   * @returns Observable of test progress
   */
  startTest(nodeId: string): Observable<CapabilityTestProgress> {
    // Start by calling the backend to initiate the test
    return this.nodesClient.testCapabilities(nodeId).pipe(
      switchMap((result: CapabilityTestResult) => {
        // Simulate animated progress for better UX
        let currentPhase = 0;
        const phases = [
          { name: 'Testing network connection...', progress: 25 },
          { name: 'Checking shared storage access...', progress: 50 },
          { name: 'Detecting hardware specs...', progress: 75 },
          { name: 'Classifying network type...', progress: 100 },
        ];

        return interval(500).pipe(
          takeWhile(() => currentPhase < phases.length),
          map(() => {
            const phase = phases[currentPhase];
            currentPhase++;

            const isComplete = currentPhase === phases.length;

            const progress: CapabilityTestProgress = {
              currentPhase: currentPhase,
              totalPhases: phases.length,
              progress: phase.progress,
              currentTest: phase.name,
              results: isComplete ? result : null,
              isComplete,
              error: null,
            };

            return progress;
          })
        );
      }),
      catchError((error) => {
        const errorProgress: CapabilityTestProgress = {
          currentPhase: 0,
          totalPhases: 4,
          progress: 0,
          currentTest: 'Test failed',
          results: null,
          isComplete: false,
          error: error?.message || 'Unknown error occurred',
        };
        return of(errorProgress);
      })
    );
  }

  /**
   * Get current test status (for resuming)
   *
   * @param nodeId - Node ID
   * @returns Observable of capability test result
   */
  getTestStatus(nodeId: string): Observable<CapabilityTestResult> {
    return this.nodesClient.getNodeCapabilities(nodeId);
  }

  /**
   * Cancel ongoing test
   *
   * @param nodeId - Node ID
   * @returns Observable of void
   */
  cancelTest(nodeId: string): Observable<void> {
    // No backend endpoint needed - just stop polling on frontend
    return of(void 0);
  }
}
