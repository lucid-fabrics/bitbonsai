/**
 * Schedule Checker Utility
 *
 * Determines if a node is currently within its allowed encoding time windows.
 * Supports per-node scheduling with multiple time windows per week.
 *
 * @module schedule-checker
 */

import { Logger } from '@nestjs/common';
import type { Node } from '@prisma/client';
import type { JsonValue } from '@prisma/client/runtime/library';

const logger = new Logger('ScheduleChecker');

/**
 * Represents a time window for encoding operations.
 *
 * @interface TimeWindow
 * @property {number} dayOfWeek - Day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
 * @property {number} startHour - Starting hour (0-23)
 * @property {number} endHour - Ending hour (0-23)
 * @property {number} [startMinute] - Optional starting minute (0-59)
 * @property {number} [endMinute] - Optional ending minute (0-59)
 */
export interface TimeWindow {
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  startHour: number; // 0-23
  endHour: number; // 0-23
  startMinute?: number; // 0-59 (optional precision)
  endMinute?: number; // 0-59 (optional precision)
}

/**
 * Checks if a node is currently within its allowed encoding time windows.
 *
 * Rules:
 * 1. If scheduleEnabled is false, node is always available (24/7)
 * 2. If scheduleWindows is null/empty, node is always available
 * 3. If scheduleEnabled is true and scheduleWindows exists, check current time against windows
 * 4. Handles midnight-crossing windows (e.g., 23:00 - 07:00)
 *
 * @param {Node} node - The node to check (must include scheduleEnabled and scheduleWindows)
 * @param {Date} [currentTime] - Optional time to check against (defaults to now, used for testing)
 * @returns {boolean} True if node is in an allowed window, false otherwise
 *
 * @example
 * // Node with schedule enabled and window (Mon-Fri, 23:00-07:00)
 * const node = {
 *   scheduleEnabled: true,
 *   scheduleWindows: [
 *     { dayOfWeek: 1, startHour: 23, endHour: 7 }, // Monday night to Tuesday morning
 *     { dayOfWeek: 2, startHour: 23, endHour: 7 }, // Tuesday night to Wednesday morning
 *     // ... etc
 *   ]
 * };
 * const canEncode = isNodeInAllowedWindow(node); // true if within window
 *
 * @example
 * // Node with schedule disabled (24/7 availability)
 * const node = { scheduleEnabled: false, scheduleWindows: null };
 * const canEncode = isNodeInAllowedWindow(node); // always true
 */
export function isNodeInAllowedWindow(
  node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'>,
  currentTime: Date = new Date()
): boolean {
  // Rule 1: Schedule disabled = 24/7 availability
  if (!node.scheduleEnabled) {
    return true;
  }

  // Rule 2: No windows defined = 24/7 availability
  if (!node.scheduleWindows) {
    return true;
  }

  // Parse JSON windows (stored as JSONB in database)
  let windows: TimeWindow[];
  try {
    const raw: JsonValue = node.scheduleWindows as JsonValue;
    windows = Array.isArray(raw)
      ? (raw as unknown[] as TimeWindow[])
      : (JSON.parse(String(raw)) as TimeWindow[]);
  } catch (error: unknown) {
    // Invalid JSON = treat as 24/7 (fail open for availability)
    logger.warn('Failed to parse scheduleWindows JSON, defaulting to 24/7', error);
    return true;
  }

  // Rule 3: Empty windows array = 24/7 availability
  if (windows.length === 0) {
    return true;
  }

  // Rule 4: Check if current time matches any window
  const dayOfWeek = currentTime.getDay(); // 0=Sunday, 1=Monday, etc.
  const currentHour = currentTime.getHours(); // 0-23
  const currentMinute = currentTime.getMinutes(); // 0-59

  for (const window of windows) {
    // Check if day matches
    if (window.dayOfWeek !== dayOfWeek) {
      continue;
    }

    // Calculate time in minutes for precision
    const currentTimeMinutes = currentHour * 60 + currentMinute;
    const startMinutes = window.startHour * 60 + (window.startMinute ?? 0);
    const endMinutes = window.endHour * 60 + (window.endMinute ?? 0);

    // Handle midnight-crossing windows (e.g., 23:00 - 07:00)
    if (endMinutes < startMinutes) {
      // Window crosses midnight
      // Match if: current time >= start OR current time < end
      if (currentTimeMinutes >= startMinutes || currentTimeMinutes < endMinutes) {
        return true;
      }
    } else {
      // Normal window (doesn't cross midnight)
      // Match if: start <= current time < end
      if (currentTimeMinutes >= startMinutes && currentTimeMinutes < endMinutes) {
        return true;
      }
    }
  }

  // No matching window found
  return false;
}

/**
 * Gets a human-readable description of a node's schedule status.
 *
 * @param {Node} node - The node to describe
 * @returns {string} Human-readable schedule description
 *
 * @example
 * const node = { scheduleEnabled: true, scheduleWindows: [...] };
 * console.log(getScheduleDescription(node));
 * // "Schedule enabled with 5 time windows"
 */
export function getScheduleDescription(
  node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'>
): string {
  if (!node.scheduleEnabled) {
    return 'Available 24/7 (schedule disabled)';
  }

  if (!node.scheduleWindows) {
    return 'Available 24/7 (no windows defined)';
  }

  try {
    const raw: JsonValue = node.scheduleWindows as JsonValue;
    const windows = Array.isArray(raw)
      ? (raw as unknown[] as TimeWindow[])
      : (JSON.parse(String(raw)) as TimeWindow[]);

    if (windows.length === 0) {
      return 'Available 24/7 (empty windows)';
    }

    return `Schedule enabled with ${windows.length} time window${windows.length === 1 ? '' : 's'}`;
  } catch {
    return 'Available 24/7 (invalid schedule)';
  }
}

/**
 * Formats a time window as a human-readable string.
 *
 * @param {TimeWindow} window - The time window to format
 * @returns {string} Formatted string (e.g., "Monday 23:00 - 07:00")
 */
export function formatTimeWindow(window: TimeWindow): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = days[window.dayOfWeek] ?? 'Unknown';

  const formatTime = (hour: number, minute?: number): string => {
    const h = hour.toString().padStart(2, '0');
    const m = (minute ?? 0).toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  const startTime = formatTime(window.startHour, window.startMinute);
  const endTime = formatTime(window.endHour, window.endMinute);

  return `${dayName} ${startTime} - ${endTime}`;
}
