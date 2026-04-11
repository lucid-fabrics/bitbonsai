import { Test, TestingModule } from '@nestjs/testing';
import {
  QualityMetrics,
  QualityMetricsService,
  QualityValidationResult,
} from '../../quality-metrics.service';

describe('QualityMetricsService', () => {
  let service: QualityMetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QualityMetricsService],
    }).compile();

    service = module.get<QualityMetricsService>(QualityMetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateQuality', () => {
    it('should pass when VMAF meets threshold', () => {
      const metrics: QualityMetrics = {
        vmaf: 90,
        calculatedAt: new Date(),
      };
      const result = service.validateQuality(metrics, 85);

      expect(result.passed).toBe(true);
      expect(result.vmaf).toBe(90);
      expect(result.threshold).toBe(85);
      expect(result.qualityLabel).toBe('Excellent');
      expect(result.reencodeTriggered).toBe(false);
    });

    it('should fail when VMAF is below threshold', () => {
      const metrics: QualityMetrics = {
        vmaf: 75,
        calculatedAt: new Date(),
      };
      const result = service.validateQuality(metrics, 85);

      expect(result.passed).toBe(false);
      expect(result.vmaf).toBe(75);
      expect(result.reencodeTriggered).toBe(true);
    });

    it('should handle missing VMAF gracefully', () => {
      const metrics: QualityMetrics = {
        psnr: 40,
        calculatedAt: new Date(),
      };
      const result = service.validateQuality(metrics, 85);

      expect(result.passed).toBe(true);
      expect(result.qualityLabel).toBe('Unknown');
      expect(result.vmaf).toBeUndefined();
    });

    it('should use default threshold of 85 when not specified', () => {
      const metrics: QualityMetrics = {
        vmaf: 84,
        calculatedAt: new Date(),
      };
      const result = service.validateQuality(metrics);

      expect(result.passed).toBe(false);
      expect(result.threshold).toBe(85);
    });
  });

  describe('toJsonString and fromJsonString', () => {
    it('should serialize and deserialize quality metrics', () => {
      const metrics: QualityMetrics = {
        vmaf: 92.5,
        psnr: 38.2,
        ssim: 0.97,
        calculatedAt: new Date('2026-03-29T06:00:00Z'),
      };

      const json = service.toJsonString(metrics);
      const parsed = service.fromJsonString(json);

      expect(parsed?.vmaf).toBe(92.5);
      expect(parsed?.psnr).toBe(38.2);
      expect(parsed?.ssim).toBe(0.97);
      expect(parsed?.calculatedAt).toBeInstanceOf(Date);
    });

    it('should return null for null input', () => {
      const result = service.fromJsonString(null);
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = service.fromJsonString('');
      expect(result).toBeNull();
    });
  });

  describe('qualifyVmafScore', () => {
    it('should return "Excellent" for score >= 80', () => {
      // Access via validateQuality which calls qualifyVmafScore internally
      const result = service.validateQuality({ vmaf: 95, calculatedAt: new Date() });
      expect(result.qualityLabel).toBe('Excellent');
    });

    it('should return "Good" for score 60-79', () => {
      const result = service.validateQuality({ vmaf: 70, calculatedAt: new Date() });
      expect(result.qualityLabel).toBe('Good');
    });

    it('should return "Fair" for score 40-59', () => {
      const result = service.validateQuality({ vmaf: 50, calculatedAt: new Date() });
      expect(result.qualityLabel).toBe('Fair');
    });

    it('should return "Poor" for score < 40', () => {
      const result = service.validateQuality({ vmaf: 30, calculatedAt: new Date() });
      expect(result.qualityLabel).toBe('Poor');
    });
  });

  describe('isAvailable', () => {
    it('should check for VMAF support in FFmpeg', async () => {
      const available = await service.isAvailable();
      // Returns boolean - either true or false depending on FFmpeg build
      expect(typeof available).toBe('boolean');
    });
  });
});
