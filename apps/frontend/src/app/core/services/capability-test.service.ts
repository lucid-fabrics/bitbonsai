import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, interval, map, Observable, of, switchMap, takeWhile } from 'rxjs';
import { DiscoveryService } from '../../features/node-setup/services/discovery.service';
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
  private readonly http = inject(HttpClient);
  private readonly discoveryService = inject(DiscoveryService);

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
    // Get the main node URL from discovery service
    const mainNodeUrl = this.discoveryService.getMainNodeUrl();

    if (!mainNodeUrl) {
      // If no main node URL, return error immediately
      const errorProgress: CapabilityTestProgress = {
        currentPhase: 0,
        totalPhases: 4,
        progress: 0,
        currentTest: 'No main node URL available',
        results: null,
        isComplete: false,
        error: 'Main node URL not set. Please restart the pairing process.',
      };
      return of(errorProgress);
    }

    // Call the MAIN node's backend (not the child node's backend)
    const testUrl = `${mainNodeUrl}/api/v1/nodes/${nodeId}/test-capabilities`;

    return this.http.post<CapabilityTestResult>(testUrl, {}).pipe(
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
    const mainNodeUrl = this.discoveryService.getMainNodeUrl();

    if (!mainNodeUrl) {
      throw new Error('Main node URL not set');
    }

    return this.http.get<CapabilityTestResult>(
      `${mainNodeUrl}/api/v1/nodes/${nodeId}/capabilities`
    );
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
