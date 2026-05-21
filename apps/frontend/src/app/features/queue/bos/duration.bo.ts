/**
 * Business Object for duration formatting logic
 * Following SRP: Separates duration formatting from components
 */
export class DurationBo {
  /**
   * Format seconds to human-readable duration
   * Examples:
   * - 45 seconds -> "45s"
   * - 125 seconds -> "2m 5s"
   * - 3661 seconds -> "1h 1m"
   * - 90000 seconds -> "1d 1h"
   */
  static formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
    }
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
}
