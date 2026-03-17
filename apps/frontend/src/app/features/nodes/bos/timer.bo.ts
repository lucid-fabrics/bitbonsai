/**
 * Business Object for timer formatting and display logic
 * Following SRP: Separates time-related business logic from components
 */
export class TimerBo {
  /**
   * Format countdown seconds as MM:SS
   */
  static formatCountdown(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}
