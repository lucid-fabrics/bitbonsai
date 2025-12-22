import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { JobStage, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Time window for encoding schedule
 */
export interface TimeWindow {
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  startHour: number; // 0-23
  endHour: number; // 0-23 (can be less than startHour for overnight)
}

/**
 * EncodingSchedulerService
 *
 * Manages time-based encoding windows for nodes.
 * Allows encoding only during specified hours (e.g., nights, weekends).
 *
 * Features:
 * - Per-node schedule configuration
 * - Day-of-week support
 * - Overnight windows (e.g., 22:00 - 06:00)
 * - Auto-pause/resume based on schedule
 * - Global schedule override
 */
@Injectable()
export class EncodingSchedulerService {
  private readonly logger = new Logger(EncodingSchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if encoding is currently allowed for a node
   *
   * @param nodeId - Node ID to check
   * @returns true if encoding is allowed right now
   */
  async isEncodingAllowed(nodeId: string): Promise<boolean> {
    try {
      const node = await this.prisma.node.findUnique({
        where: { id: nodeId },
        select: {
          scheduleEnabled: true,
          scheduleWindows: true,
        },
      });

      if (!node) {
        this.logger.warn(`Node ${nodeId} not found`);
        return true; // Allow encoding if node not found
      }

      // If scheduling is disabled, always allow
      if (!node.scheduleEnabled) {
        return true;
      }

      // Parse schedule windows
      const windows = node.scheduleWindows as TimeWindow[] | null;

      if (!windows || windows.length === 0) {
        this.logger.warn(`Node ${nodeId} has scheduling enabled but no windows defined`);
        return true; // Allow if no windows defined
      }

      return this.isInAnyWindow(windows);
    } catch (error) {
      this.logger.error(`Error checking schedule for node ${nodeId}: ${error}`);
      return true; // Allow on error
    }
  }

  /**
   * Check if current time falls within any of the given windows
   */
  private isInAnyWindow(windows: TimeWindow[]): boolean {
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday
    const currentHour = now.getHours();

    for (const window of windows) {
      // Check if today matches the window's day
      if (window.dayOfWeek !== currentDay) {
        continue;
      }

      // Handle overnight windows (e.g., 22:00 - 06:00)
      if (window.startHour > window.endHour) {
        // Overnight: allowed if hour >= start OR hour < end
        if (currentHour >= window.startHour || currentHour < window.endHour) {
          return true;
        }
      } else {
        // Same day: allowed if hour >= start AND hour < end
        if (currentHour >= window.startHour && currentHour < window.endHour) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get next allowed encoding time for a node
   *
   * @param nodeId - Node ID
   * @returns Next Date when encoding will be allowed, or null if always allowed
   */
  async getNextAllowedTime(nodeId: string): Promise<Date | null> {
    try {
      const node = await this.prisma.node.findUnique({
        where: { id: nodeId },
        select: {
          scheduleEnabled: true,
          scheduleWindows: true,
        },
      });

      if (!node?.scheduleEnabled) {
        return null; // Always allowed
      }

      const windows = node.scheduleWindows as TimeWindow[] | null;

      if (!windows || windows.length === 0) {
        return null;
      }

      if (this.isInAnyWindow(windows)) {
        return null; // Currently allowed
      }

      // Find the next window start
      return this.findNextWindowStart(windows);
    } catch (error) {
      this.logger.error(`Error getting next allowed time for node ${nodeId}: ${error}`);
      return null;
    }
  }

  /**
   * Find the next window start time
   */
  private findNextWindowStart(windows: TimeWindow[]): Date {
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();

    let nearestStart: Date | null = null;

    // Check next 7 days
    for (let daysAhead = 0; daysAhead < 7; daysAhead++) {
      const checkDay = (currentDay + daysAhead) % 7;

      for (const window of windows) {
        if (window.dayOfWeek !== checkDay) {
          continue;
        }

        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() + daysAhead);
        startDate.setHours(window.startHour, 0, 0, 0);

        // Skip if this start time is in the past
        if (startDate <= now) {
          continue;
        }

        if (!nearestStart || startDate < nearestStart) {
          nearestStart = startDate;
        }
      }
    }

    return nearestStart || new Date(now.getTime() + 24 * 60 * 60 * 1000); // Default to 24h
  }

  /**
   * Periodically check schedules and auto-pause/resume jobs
   * Runs every 5 minutes
   */
  @Interval(5 * 60 * 1000)
  async enforceSchedules(): Promise<void> {
    try {
      // Get all nodes with scheduling enabled
      const nodesWithSchedules = await this.prisma.node.findMany({
        where: {
          scheduleEnabled: true,
          scheduleWindows: { not: Prisma.JsonNull },
        },
        select: {
          id: true,
          name: true,
          scheduleWindows: true,
        },
      });

      for (const node of nodesWithSchedules) {
        const windows = node.scheduleWindows as TimeWindow[] | null;

        if (!windows || windows.length === 0) {
          continue;
        }

        const isAllowed = this.isInAnyWindow(windows);

        if (!isAllowed) {
          // Outside schedule - pause any active jobs for this node
          const pausedCount = await this.pauseJobsForNode(node.id);
          if (pausedCount > 0) {
            this.logger.log(
              `⏸️ Paused ${pausedCount} job(s) for node ${node.name} - outside schedule window`
            );
          }
        } else {
          // Inside schedule - resume any schedule-paused jobs
          const resumedCount = await this.resumeJobsForNode(node.id);
          if (resumedCount > 0) {
            this.logger.log(
              `▶️ Resumed ${resumedCount} job(s) for node ${node.name} - inside schedule window`
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error enforcing schedules: ${error}`);
    }
  }

  /**
   * Pause active jobs for a node (outside schedule)
   */
  private async pauseJobsForNode(nodeId: string): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: {
        nodeId,
        stage: {
          in: [JobStage.QUEUED, JobStage.ENCODING],
        },
      },
      data: {
        stage: JobStage.PAUSED,
        error: 'Paused: Outside scheduled encoding window',
      },
    });

    return result.count;
  }

  /**
   * Resume schedule-paused jobs for a node
   */
  private async resumeJobsForNode(nodeId: string): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: {
        nodeId,
        stage: JobStage.PAUSED,
        error: { contains: 'Outside scheduled encoding window' },
      },
      data: {
        stage: JobStage.QUEUED,
        error: null,
      },
    });

    return result.count;
  }

  /**
   * Set schedule for a node
   *
   * @param nodeId - Node ID
   * @param enabled - Whether scheduling is enabled
   * @param windows - Array of time windows (optional if disabled)
   */
  async setNodeSchedule(nodeId: string, enabled: boolean, windows?: TimeWindow[]): Promise<void> {
    await this.prisma.node.update({
      where: { id: nodeId },
      data: {
        scheduleEnabled: enabled,
        scheduleWindows:
          enabled && windows ? (windows as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    this.logger.log(`Updated schedule for node ${nodeId}: enabled=${enabled}`);
  }

  /**
   * Get common preset schedules
   */
  getPresetSchedules(): Record<string, TimeWindow[]> {
    return {
      // Nights only (10 PM - 6 AM every day)
      nights: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        dayOfWeek: day,
        startHour: 22,
        endHour: 6,
      })),

      // Weekends only (all day Saturday and Sunday)
      weekends: [
        { dayOfWeek: 0, startHour: 0, endHour: 24 }, // Sunday
        { dayOfWeek: 6, startHour: 0, endHour: 24 }, // Saturday
      ],

      // Weekday nights (Mon-Fri 10 PM - 6 AM)
      weekdayNights: [1, 2, 3, 4, 5].map((day) => ({
        dayOfWeek: day,
        startHour: 22,
        endHour: 6,
      })),

      // Off-peak (nights + weekends)
      offPeak: [
        // Weekday nights
        ...[1, 2, 3, 4, 5].map((day) => ({
          dayOfWeek: day,
          startHour: 22,
          endHour: 6,
        })),
        // All day weekends
        { dayOfWeek: 0, startHour: 0, endHour: 24 },
        { dayOfWeek: 6, startHour: 0, endHour: 24 },
      ],

      // Business hours excluded (before 9 AM, after 5 PM on weekdays)
      nonBusinessHours: [
        // Weekdays: before 9 AM and after 5 PM
        ...[1, 2, 3, 4, 5].flatMap((day) => [
          { dayOfWeek: day, startHour: 0, endHour: 9 },
          { dayOfWeek: day, startHour: 17, endHour: 24 },
        ]),
        // All day weekends
        { dayOfWeek: 0, startHour: 0, endHour: 24 },
        { dayOfWeek: 6, startHour: 0, endHour: 24 },
      ],
    };
  }
}
