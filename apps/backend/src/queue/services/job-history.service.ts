import { Injectable, Logger } from '@nestjs/common';
import { JobEventType, JobStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RecordJobEventParams {
  jobId: string;
  eventType: JobEventType;
  stage: JobStage;
  progress: number;
  errorMessage?: string;
  errorDetails?: string;
  wasAutoHealed?: boolean;
  tempFileExists?: boolean;
  retryNumber?: number;
  triggeredBy?: 'USER' | 'SYSTEM' | 'BACKEND_RESTART' | 'TIMEOUT' | 'MANUAL';
  systemMessage?: string;
  fps?: number;
  etaSeconds?: number;
  startedFromSeconds?: number;
}

@Injectable()
export class JobHistoryService {
  private readonly logger = new Logger(JobHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a job event in history
   */
  async recordEvent(params: RecordJobEventParams): Promise<void> {
    try {
      await this.prisma.jobHistory.create({
        data: {
          jobId: params.jobId,
          eventType: params.eventType,
          stage: params.stage,
          progress: params.progress,
          errorMessage: params.errorMessage,
          errorDetails: params.errorDetails,
          wasAutoHealed: params.wasAutoHealed ?? false,
          tempFileExists: params.tempFileExists,
          retryNumber: params.retryNumber,
          triggeredBy: params.triggeredBy,
          systemMessage: params.systemMessage ?? this.generateSystemMessage(params),
          fps: params.fps,
          etaSeconds: params.etaSeconds,
          startedFromSeconds: params.startedFromSeconds,
        },
      });

      this.logger.log(
        `Recorded ${params.eventType} event for job ${params.jobId} at ${params.progress.toFixed(1)}%`
      );
    } catch (error) {
      this.logger.error(
        `Failed to record job history event`,
        error instanceof Error ? error.stack : String(error)
      );
    }
  }

  /**
   * Get job history timeline for a specific job
   */
  async getJobHistory(jobId: string) {
    return this.prisma.jobHistory.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get the number of failure events for a job
   */
  async getFailureCount(jobId: string): Promise<number> {
    return this.prisma.jobHistory.count({
      where: {
        jobId,
        eventType: {
          in: [JobEventType.FAILED, JobEventType.BACKEND_RESTART, JobEventType.TIMEOUT],
        },
      },
    });
  }

  /**
   * Generate a user-friendly system message based on event parameters
   */
  private generateSystemMessage(params: RecordJobEventParams): string {
    switch (params.eventType) {
      case JobEventType.FAILED:
        if (params.retryNumber) {
          return `Attempt #${params.retryNumber} failed at ${params.progress.toFixed(1)}%`;
        }
        return `Encoding failed at ${params.progress.toFixed(1)}%`;

      case JobEventType.CANCELLED:
        return params.triggeredBy === 'USER'
          ? `Cancelled by user at ${params.progress.toFixed(1)}%`
          : `Cancelled by system at ${params.progress.toFixed(1)}%`;

      case JobEventType.RESTARTED:
        if (params.startedFromSeconds) {
          return `Restarted from ${Math.floor(params.startedFromSeconds / 60)} minutes`;
        }
        return `Restarted encoding from beginning`;

      case JobEventType.AUTO_HEALED:
        if (params.wasAutoHealed && params.tempFileExists) {
          return `Successfully resumed from ${params.progress.toFixed(1)}% after backend restart`;
        }
        return `Attempted to auto-heal but temp file was lost - restarting from 0%`;

      case JobEventType.BACKEND_RESTART:
        return `Encoding interrupted by backend restart at ${params.progress.toFixed(1)}%`;

      case JobEventType.TIMEOUT: {
        const hours = params.etaSeconds ? Math.floor(params.etaSeconds / 3600) : 0;
        return `Encoding timed out after ${hours} hours at ${params.progress.toFixed(1)}%`;
      }

      default:
        return `Event occurred at ${params.progress.toFixed(1)}%`;
    }
  }
}
