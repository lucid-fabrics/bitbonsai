import { FileHealthStatus } from '../models/library.model';

/**
 * Business Object for file health status formatting and presentation logic
 * Following SRP: Separates health status logic from components
 */
export class FileHealthBo {
  /**
   * Get icon class for health status
   */
  static getHealthStatusIcon(status: FileHealthStatus): string {
    switch (status) {
      case FileHealthStatus.HEALTHY:
        return 'fas fa-check-circle';
      case FileHealthStatus.WARNING:
        return 'fas fa-exclamation-triangle';
      case FileHealthStatus.CORRUPTED:
        return 'fas fa-times-circle';
      case FileHealthStatus.UNKNOWN:
      default:
        return 'fas fa-question-circle';
    }
  }

  /**
   * Get CSS class for health status
   */
  static getHealthStatusClass(status: FileHealthStatus): string {
    switch (status) {
      case FileHealthStatus.HEALTHY:
        return 'health-healthy';
      case FileHealthStatus.WARNING:
        return 'health-warning';
      case FileHealthStatus.CORRUPTED:
        return 'health-corrupted';
      case FileHealthStatus.UNKNOWN:
      default:
        return 'health-unknown';
    }
  }

  /**
   * Check if file is selectable (healthy or warning, not corrupted)
   */
  static isFileSelectable(status: FileHealthStatus): boolean {
    return status === FileHealthStatus.HEALTHY || status === FileHealthStatus.WARNING;
  }

  /**
   * Get human-readable health status label
   */
  static getHealthStatusLabel(status: FileHealthStatus): string {
    switch (status) {
      case FileHealthStatus.HEALTHY:
        return 'Healthy';
      case FileHealthStatus.WARNING:
        return 'Warning';
      case FileHealthStatus.CORRUPTED:
        return 'Corrupted';
      case FileHealthStatus.UNKNOWN:
      default:
        return 'Unknown';
    }
  }
}
