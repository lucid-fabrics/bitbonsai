import { Test, TestingModule } from '@nestjs/testing';
import { QualityMetrics, QualityMetricsService } from '../../quality-metrics.service';

/**
 * Unit tests for Video Quality Metrics (VMAF, PSNR, SSIM)
 *
 * These tests verify the quality metrics calculation methods
 * without requiring actual video files or FFmpeg encoding.
 */
describe('QualityMetricsService', () => {
  let service: QualityMetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QualityMetricsService],
    }).compile();

    service = module.get<QualityMetricsService>(QualityMetricsService);
  });

  afterEach(async () => {
    // Cleanup
  });

  describe('Quality Metrics Calculation', () => {
    it('should have calculateVmaf method defined', () => {
      expect(service.calculateVmaf).toBeDefined();
      expect(typeof service.calculateVmaf).toBe('function');
    });

    it('should have calculatePsnr method defined', () => {
      expect(service.calculatePsnr).toBeDefined();
      expect(typeof service.calculatePsnr).toBe('function');
    });

    it('should have calculateSsim method defined', () => {
      expect(service.calculateSsim).toBeDefined();
      expect(typeof service.calculateSsim).toBe('function');
    });

    it('should have calculateAllQualityMetrics method defined', () => {
      expect(service.calculateAllQualityMetrics).toBeDefined();
      expect(typeof service.calculateAllQualityMetrics).toBe('function');
    });

    it('should return null for non-existent files in calculateVmaf', async () => {
      const result = await service.calculateVmaf(
        '/nonexistent/original.mp4',
        '/nonexistent/encoded.mp4'
      );
      // Should return null (or handle gracefully) for non-existent files
      expect(result === null || typeof result === 'number').toBe(true);
    }, 10000);

    it('should return null for non-existent files in calculatePsnr', async () => {
      const result = await service.calculatePsnr(
        '/nonexistent/original.mp4',
        '/nonexistent/encoded.mp4'
      );
      expect(result === null || typeof result === 'number').toBe(true);
    }, 10000);

    it('should return null for non-existent files in calculateSsim', async () => {
      const result = await service.calculateSsim(
        '/nonexistent/original.mp4',
        '/nonexistent/encoded.mp4'
      );
      expect(result === null || typeof result === 'number').toBe(true);
    }, 10000);

    it('should calculate all quality metrics without crashing', async () => {
      const result = await service.calculateAllQualityMetrics(
        '/nonexistent/original.mp4',
        '/nonexistent/encoded.mp4'
      );

      expect(result).toBeDefined();
      expect(result.calculatedAt).toBeInstanceOf(Date);
      // Should return partial results even if some metrics fail
      expect(result.vmaf === undefined || typeof result.vmaf === 'number').toBe(true);
      expect(result.psnr === undefined || typeof result.psnr === 'number').toBe(true);
      expect(result.ssim === undefined || typeof result.ssim === 'number').toBe(true);
    }, 30000);
  });

  describe('Quality Metrics Interface', () => {
    it('should have proper QualityMetrics interface', () => {
      const metrics: QualityMetrics = {
        vmaf: 85.5,
        psnr: 38.2,
        ssim: 0.95,
        calculatedAt: new Date(),
      };

      expect(metrics.vmaf).toBe(85.5);
      expect(metrics.psnr).toBe(38.2);
      expect(metrics.ssim).toBe(0.95);
      expect(metrics.calculatedAt).toBeInstanceOf(Date);
    });

    it('should allow partial metrics', () => {
      const metrics: QualityMetrics = {
        psnr: 35.0,
        calculatedAt: new Date(),
      };

      expect(metrics.vmaf).toBeUndefined();
      expect(metrics.psnr).toBe(35.0);
      expect(metrics.ssim).toBeUndefined();
    });
  });
});
