import { Injectable, inject } from '@angular/core';
import type { QueueJob } from '../models/queue-job.model';
import { QueueFormattingService } from './queue-formatting.service';

@Injectable({
  providedIn: 'root',
})
export class QueueCompressionService {
  private readonly formatting = inject(QueueFormattingService);

  private getCompressionRatio(sourceCodec?: string, targetCodec?: string): number {
    if (!sourceCodec || !targetCodec) return 0.4;

    const source = sourceCodec.toLowerCase();
    const target = targetCodec.toLowerCase();

    if (source === target) return 0.05;

    const isH264 = (c: string) => c.includes('h.264') || c.includes('avc');
    const isHevc = (c: string) => c.includes('hevc') || c.includes('h.265');
    const isAv1 = (c: string) => c.includes('av1');
    const isVp9 = (c: string) => c.includes('vp9');

    if (isH264(source) && isHevc(target)) return 0.45;
    if (isH264(source) && isAv1(target)) return 0.5;
    if (isHevc(source) && isAv1(target)) return 0.25;
    if (isVp9(source) && isAv1(target)) return 0.2;
    if (isVp9(source) && isHevc(target)) return 0.15;
    return 0.4;
  }

  getEstimatedCompression(job: { sourceCodec?: string; targetCodec?: string }): number {
    return Math.round(this.getCompressionRatio(job.sourceCodec, job.targetCodec) * 100);
  }

  getEstimatedSize(job: {
    originalSize: number;
    sourceCodec?: string;
    targetCodec?: string;
  }): number {
    return Math.round(
      job.originalSize * (1 - this.getCompressionRatio(job.sourceCodec, job.targetCodec))
    );
  }

  calculateExpectedSize(job: QueueJob): string {
    const compressionPercent = this.getEstimatedCompression(job);
    return this.formatting.formatBytes(job.originalSize * (1 - compressionPercent / 100));
  }

  calculateExpectedSavings(job: QueueJob): string {
    const compressionPercent = this.getEstimatedCompression(job);
    return `~${this.formatting.formatBytes(job.originalSize * (compressionPercent / 100))} (${compressionPercent}%)`;
  }

  calculateEstimatedTime(totalSizeBytes: number): { hours: number; minutes: number } {
    const estimatedSeconds = totalSizeBytes / (50 * 1024 * 1024);
    return {
      hours: Math.floor(estimatedSeconds / 3600),
      minutes: Math.floor((estimatedSeconds % 3600) / 60),
    };
  }

  getAvgEncodingSpeed(): number {
    return 50 * 1024 * 1024;
  }
}
