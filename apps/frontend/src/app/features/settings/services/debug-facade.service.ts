import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DebugClient,
  type FfmpegProcessesResponse,
  type SystemLoadInfo,
} from '../../../core/clients/debug.client';

@Injectable({
  providedIn: 'root',
})
export class DebugFacadeService {
  private readonly debugClient = inject(DebugClient);
  private readonly destroyRef = inject(DestroyRef);

  // System load
  readonly systemLoadInfo = signal<SystemLoadInfo | null>(null);
  readonly loadingSystemInfo = signal(false);
  readonly loadThresholdMultiplier = signal(5.0);
  readonly savingThreshold = signal(false);

  // FFmpeg processes
  readonly ffmpegData = signal<FfmpegProcessesResponse | null>(null);
  readonly loadingProcesses = signal(false);
  readonly killingZombies = signal(false);

  loadSystemInfo(): void {
    this.loadingSystemInfo.set(true);
    this.debugClient
      .getSystemLoad()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (info) => {
          this.systemLoadInfo.set(info);
          this.loadThresholdMultiplier.set(info.loadThresholdMultiplier);
          this.loadingSystemInfo.set(false);
        },
        error: () => {
          this.loadingSystemInfo.set(false);
        },
      });
  }

  loadFfmpegProcesses(): void {
    this.loadingProcesses.set(true);
    this.debugClient
      .getFfmpegProcesses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.ffmpegData.set(data);
          this.loadingProcesses.set(false);
        },
        error: () => {
          this.loadingProcesses.set(false);
        },
      });
  }

  updateLoadThreshold(
    multiplier: number,
    onSuccess: (msg: string) => void,
    onError: (msg: string) => void
  ): void {
    if (multiplier < 1.0 || multiplier > 10.0) {
      onError('Multiplier must be between 1.0 and 10.0');
      return;
    }

    this.savingThreshold.set(true);
    this.debugClient
      .updateLoadThreshold(multiplier)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.savingThreshold.set(false);
          if (result.success) {
            onSuccess(
              `Load threshold updated to ${result.loadThresholdMultiplier}x (max load: ${result.maxLoad})`
            );
            this.loadSystemInfo();
          } else {
            onError(result.message || 'Failed to update threshold');
          }
        },
        error: () => {
          this.savingThreshold.set(false);
          onError('Failed to update load threshold');
        },
      });
  }

  killProcess(pid: number, onSuccess: (msg: string) => void, onError: (msg: string) => void): void {
    this.debugClient
      .killFfmpegProcess(pid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (result.success) {
            onSuccess(result.message);
            this.loadFfmpegProcesses();
          } else {
            onError(result.message);
          }
        },
        error: () => {
          onError(`Failed to kill process ${pid}`);
        },
      });
  }

  killAllZombies(onSuccess: (msg: string) => void, onError: (msg: string) => void): void {
    this.killingZombies.set(true);
    this.debugClient
      .killAllZombies()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.killingZombies.set(false);
          onSuccess(`Killed ${result.killed} zombie processes (${result.failed} failed)`);
          this.loadFfmpegProcesses();
        },
        error: () => {
          this.killingZombies.set(false);
          onError('Failed to kill zombie processes');
        },
      });
  }
}
