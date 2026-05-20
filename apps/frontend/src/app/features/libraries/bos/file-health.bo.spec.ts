import { FileHealthStatus } from '../models/library.model';
import { FileHealthBo } from './file-health.bo';

describe('FileHealthBo', () => {
  describe('getHealthStatusIcon', () => {
    it('should return check-circle for HEALTHY', () => {
      expect(FileHealthBo.getHealthStatusIcon(FileHealthStatus.HEALTHY)).toBe(
        'fas fa-check-circle'
      );
    });

    it('should return exclamation-triangle for WARNING', () => {
      expect(FileHealthBo.getHealthStatusIcon(FileHealthStatus.WARNING)).toBe(
        'fas fa-exclamation-triangle'
      );
    });

    it('should return times-circle for CORRUPTED', () => {
      expect(FileHealthBo.getHealthStatusIcon(FileHealthStatus.CORRUPTED)).toBe(
        'fas fa-times-circle'
      );
    });

    it('should return question-circle for unknown status', () => {
      expect(FileHealthBo.getHealthStatusIcon('UNKNOWN' as FileHealthStatus)).toBe(
        'fas fa-question-circle'
      );
    });
  });

  describe('getHealthStatusClass', () => {
    it('should return health-healthy for HEALTHY', () => {
      expect(FileHealthBo.getHealthStatusClass(FileHealthStatus.HEALTHY)).toBe('health-healthy');
    });

    it('should return health-warning for WARNING', () => {
      expect(FileHealthBo.getHealthStatusClass(FileHealthStatus.WARNING)).toBe('health-warning');
    });

    it('should return health-corrupted for CORRUPTED', () => {
      expect(FileHealthBo.getHealthStatusClass(FileHealthStatus.CORRUPTED)).toBe(
        'health-corrupted'
      );
    });

    it('should return health-unknown for unrecognised status', () => {
      expect(FileHealthBo.getHealthStatusClass('MYSTERY' as FileHealthStatus)).toBe(
        'health-unknown'
      );
    });
  });

  describe('isFileSelectable', () => {
    it('should return true for HEALTHY files', () => {
      expect(FileHealthBo.isFileSelectable(FileHealthStatus.HEALTHY)).toBe(true);
    });

    it('should return true for WARNING files', () => {
      expect(FileHealthBo.isFileSelectable(FileHealthStatus.WARNING)).toBe(true);
    });

    it('should return false for CORRUPTED files', () => {
      expect(FileHealthBo.isFileSelectable(FileHealthStatus.CORRUPTED)).toBe(false);
    });

    it('should return false for UNKNOWN status', () => {
      expect(FileHealthBo.isFileSelectable(FileHealthStatus.UNKNOWN)).toBe(false);
    });
  });

  describe('getHealthStatusLabel', () => {
    it('should return Healthy for HEALTHY', () => {
      expect(FileHealthBo.getHealthStatusLabel(FileHealthStatus.HEALTHY)).toBe('Healthy');
    });

    it('should return Warning for WARNING', () => {
      expect(FileHealthBo.getHealthStatusLabel(FileHealthStatus.WARNING)).toBe('Warning');
    });

    it('should return Corrupted for CORRUPTED', () => {
      expect(FileHealthBo.getHealthStatusLabel(FileHealthStatus.CORRUPTED)).toBe('Corrupted');
    });

    it('should return Unknown for unrecognised status', () => {
      expect(FileHealthBo.getHealthStatusLabel('NOPE' as FileHealthStatus)).toBe('Unknown');
    });
  });
});
