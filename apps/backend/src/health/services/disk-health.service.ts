import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { LibraryRepository } from '../../common/repositories/library.repository';
import type { DiskHealthDto } from '../dto/disk-health.dto';
import type { DiskSpaceMonitoringDto } from '../dto/disk-space-monitoring.dto';
import type { LibraryDiskSpaceDto } from '../dto/library-disk-space.dto';

const execAsync = promisify(exec);

@Injectable()
export class DiskHealthService {
  private readonly logger = new Logger(DiskHealthService.name);

  private readonly DISK_SPACE_BUFFER_PERCENT = 20;
  private readonly MIN_FREE_DISK_SPACE_GB = 5;
  private readonly WARNING_THRESHOLD_PERCENT = 80;
  private readonly CRITICAL_THRESHOLD_PERCENT = 90;

  constructor(private readonly libraryRepository: LibraryRepository) {}

  async checkDiskHealth(): Promise<DiskHealthDto> {
    try {
      const { stdout } = await execAsync('df -h / | tail -1');
      const parts = stdout.trim().split(/\s+/);
      const usedPercent = Number.parseFloat(parts[4]?.replace('%', '') || '0');
      const available = parts[3] || 'Unknown';

      let status: 'ok' | 'warning' | 'critical' = 'ok';
      if (usedPercent > 90) status = 'critical';
      else if (usedPercent > 80) status = 'warning';

      return { status, used: `${Math.round(usedPercent)}%`, available };
    } catch (error: unknown) {
      this.logger.error('Disk health check failed:', error);
      return { status: 'ok', used: 'N/A', available: 'N/A' };
    }
  }

  async monitorLibraryDiskSpace(): Promise<DiskSpaceMonitoringDto> {
    try {
      const libraries = (await this.libraryRepository.findAllLibraries(undefined, {
        jobs: {
          where: { stage: { in: ['QUEUED', 'ENCODING'] } },
          select: { id: true, filePath: true, beforeSizeBytes: true },
        },
      })) as (import('@prisma/client').Library & {
        jobs: { id: string; filePath: string; beforeSizeBytes: bigint | null }[];
      })[];

      const librarySpaceData: LibraryDiskSpaceDto[] = [];
      const globalWarnings: string[] = [];
      let totalQueuedJobs = 0;
      let totalEstimatedSpaceNeededBigInt = BigInt(0);
      let overallStatus: 'ok' | 'warning' | 'critical' = 'ok';

      for (const library of libraries) {
        try {
          const stats = await fs.statfs(library.path);
          const totalBytes = BigInt(stats.blocks) * BigInt(stats.bsize);
          const availableBytes = BigInt(stats.bavail) * BigInt(stats.bsize);
          const usedBytes = totalBytes - availableBytes;
          const usedPercent = Number((usedBytes * BigInt(100)) / totalBytes);

          let status: 'ok' | 'warning' | 'critical' = 'ok';
          if (usedPercent >= this.CRITICAL_THRESHOLD_PERCENT) {
            status = 'critical';
            overallStatus = 'critical';
          } else if (usedPercent >= this.WARNING_THRESHOLD_PERCENT) {
            status = 'warning';
            if (overallStatus !== 'critical') overallStatus = 'warning';
          }

          const queuedJobsCount = library.jobs.length;
          totalQueuedJobs += queuedJobsCount;

          let estimatedSpaceNeededBytes: bigint | null = null;
          let hasEnoughSpaceForQueue = true;
          let warningMessage: string | null = null;

          if (queuedJobsCount > 0) {
            let queueSpaceEstimate = BigInt(0);
            for (const job of library.jobs) {
              const jobSize = BigInt(job.beforeSizeBytes || 0);
              queueSpaceEstimate +=
                (jobSize * BigInt(100 + this.DISK_SPACE_BUFFER_PERCENT)) / BigInt(100);
            }

            estimatedSpaceNeededBytes = queueSpaceEstimate;
            totalEstimatedSpaceNeededBigInt += queueSpaceEstimate;

            const minimumRequired =
              queueSpaceEstimate + BigInt(this.MIN_FREE_DISK_SPACE_GB) * BigInt(1024 ** 3);
            hasEnoughSpaceForQueue = availableBytes >= minimumRequired;

            if (!hasEnoughSpaceForQueue) {
              const shortfall = minimumRequired - availableBytes;
              const shortfallGB = Number(shortfall) / 1024 ** 3;
              warningMessage = `Insufficient space: need ${shortfallGB.toFixed(1)} GB more to complete ${queuedJobsCount} queued jobs`;
              globalWarnings.push(`Library "${library.name}": ${warningMessage}`);
              if (status === 'ok') status = 'warning';
            } else if (status !== 'ok') {
              warningMessage = `Disk space ${status}: ${usedPercent.toFixed(0)}% used, but ${queuedJobsCount} queued jobs should complete`;
            }
          } else if (status !== 'ok') {
            warningMessage = `Disk space ${status}: ${usedPercent.toFixed(0)}% used`;
            globalWarnings.push(`Library "${library.name}": ${warningMessage}`);
          }

          librarySpaceData.push({
            libraryId: library.id,
            libraryName: library.name,
            path: library.path,
            status,
            totalBytes: totalBytes.toString(),
            availableBytes: availableBytes.toString(),
            usedBytes: usedBytes.toString(),
            usedPercent,
            availableFormatted: this.formatBytes(Number(availableBytes)),
            totalFormatted: this.formatBytes(Number(totalBytes)),
            queuedJobsCount,
            estimatedSpaceNeededBytes: estimatedSpaceNeededBytes?.toString() ?? null,
            hasEnoughSpaceForQueue,
            warningMessage,
          });
        } catch (error: unknown) {
          this.logger.warn(
            `Failed to check disk space for library ${library.name} at ${library.path}`,
            error
          );
          librarySpaceData.push({
            libraryId: library.id,
            libraryName: library.name,
            path: library.path,
            status: 'warning',
            totalBytes: '0',
            availableBytes: '0',
            usedBytes: '0',
            usedPercent: 0,
            availableFormatted: 'N/A',
            totalFormatted: 'N/A',
            queuedJobsCount: library.jobs.length,
            estimatedSpaceNeededBytes: null,
            hasEnoughSpaceForQueue: false,
            warningMessage: 'Failed to check disk space (path may not exist or be inaccessible)',
          });
        }
      }

      return {
        overallStatus,
        timestamp: new Date(),
        libraries: librarySpaceData,
        globalWarnings,
        totalQueuedJobs,
        totalEstimatedSpaceNeeded:
          totalQueuedJobs > 0 ? totalEstimatedSpaceNeededBigInt.toString() : null,
        canAccommodateQueue: librarySpaceData.every((lib) => lib.hasEnoughSpaceForQueue),
      };
    } catch (error: unknown) {
      this.logger.error('Failed to monitor library disk space', error);
      return {
        overallStatus: 'critical',
        timestamp: new Date(),
        libraries: [],
        globalWarnings: ['Failed to monitor disk space across libraries'],
        totalQueuedJobs: 0,
        totalEstimatedSpaceNeeded: null,
        canAccommodateQueue: false,
      };
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / k ** i) * 10) / 10}${sizes[i]}`;
  }
}
