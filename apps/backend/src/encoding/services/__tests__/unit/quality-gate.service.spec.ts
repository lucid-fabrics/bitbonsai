import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockJob } from '../../../../testing/mock-factories';
import type { QualityMetrics } from '../../../quality-metrics.service';
import { QualityMetricsService } from '../../../quality-metrics.service';
import { QUALITY_GATE_WARNING_PREFIX, QualityGateService } from '../../quality-gate.service';

describe('QualityGateService', () => {
  let service: QualityGateService;
  let mockPrisma: { settings: { findFirst: jest.Mock } };
  let mockQualityMetricsService: { calculateVmaf: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      settings: { findFirst: jest.fn() },
    };

    mockQualityMetricsService = {
      calculateVmaf: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityGateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QualityMetricsService, useValue: mockQualityMetricsService },
      ],
    }).compile();

    service = module.get<QualityGateService>(QualityGateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.VMAF_THRESHOLD;
  });

  // ---------------------------------------------------------------------------
  // getThreshold
  // ---------------------------------------------------------------------------

  describe('getThreshold()', () => {
    it('returns settings vmafThreshold when qualityMetricsEnabled=true', async () => {
      mockPrisma.settings.findFirst.mockResolvedValueOnce({
        vmafThreshold: 90,
        qualityMetricsEnabled: true,
      });

      const threshold = await service.getThreshold();

      expect(threshold).toBe(90);
    });

    it('returns 0 when qualityMetricsEnabled=false', async () => {
      mockPrisma.settings.findFirst.mockResolvedValueOnce({
        vmafThreshold: 90,
        qualityMetricsEnabled: false,
      });

      const threshold = await service.getThreshold();

      expect(threshold).toBe(0);
    });

    it('returns VMAF_THRESHOLD env default when settings row is null', async () => {
      mockPrisma.settings.findFirst.mockResolvedValueOnce(null);
      process.env.VMAF_THRESHOLD = '75';

      const threshold = await service.getThreshold();

      expect(threshold).toBe(75);
    });

    it('returns 85 default when settings row is null and env not set', async () => {
      mockPrisma.settings.findFirst.mockResolvedValueOnce(null);

      const threshold = await service.getThreshold();

      expect(threshold).toBe(85);
    });

    it('returns env default on DB error', async () => {
      mockPrisma.settings.findFirst.mockRejectedValueOnce(new Error('DB connection error'));
      process.env.VMAF_THRESHOLD = '72';

      const threshold = await service.getThreshold();

      expect(threshold).toBe(72);
    });

    it('returns 85 on DB error when env not set', async () => {
      mockPrisma.settings.findFirst.mockRejectedValueOnce(new Error('DB connection error'));

      const threshold = await service.getThreshold();

      expect(threshold).toBe(85);
    });
  });

  // ---------------------------------------------------------------------------
  // checkQuality
  // ---------------------------------------------------------------------------

  describe('checkQuality()', () => {
    const outputPath = '/tmp/encoded.mkv';

    function settingsEnabled(vmafThreshold = 85): void {
      mockPrisma.settings.findFirst.mockResolvedValue({
        vmafThreshold,
        qualityMetricsEnabled: true,
      });
    }

    function settingsDisabled(): void {
      mockPrisma.settings.findFirst.mockResolvedValue({
        vmafThreshold: 85,
        qualityMetricsEnabled: false,
      });
    }

    it('returns forcedPass=true when threshold=0 (qualityMetricsEnabled=false)', async () => {
      settingsDisabled();
      const job = createMockJob();

      const result = await service.checkQuality(job, outputPath);

      expect(result).toEqual({ passed: true, score: null, threshold: 0, forcedPass: true });
    });

    it('returns forcedPass=true when priorQualityGateRetries >= 3', async () => {
      settingsEnabled(85);
      const warningLines = [
        `${QUALITY_GATE_WARNING_PREFIX} retry 1`,
        `${QUALITY_GATE_WARNING_PREFIX} retry 2`,
        `${QUALITY_GATE_WARNING_PREFIX} retry 3`,
      ].join('\n');
      const job = createMockJob({ warning: warningLines });

      const result = await service.checkQuality(job, outputPath);

      expect(result.forcedPass).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('does not force-pass when priorQualityGateRetries < 3', async () => {
      settingsEnabled(85);
      const warningLines = [
        `${QUALITY_GATE_WARNING_PREFIX} retry 1`,
        `${QUALITY_GATE_WARNING_PREFIX} retry 2`,
      ].join('\n');
      const job = createMockJob({ warning: warningLines });
      // PSNR pre-gate must pass; probeVmaf returns a passing score
      mockQualityMetricsService.calculateVmaf.mockResolvedValueOnce(88);

      // Spy on private runPsnrPreGate to skip ffmpeg spawn
      jest
        .spyOn(
          service as unknown as {
            runPsnrPreGate: () => Promise<{ passed: boolean; psnr: number | null }>;
          },
          'runPsnrPreGate'
        )
        .mockResolvedValueOnce({ passed: true, psnr: 38 });

      const result = await service.checkQuality(job, outputPath);

      expect(result.forcedPass).toBe(false);
    });

    it('uses stored VMAF score when storedMetrics.vmaf is present', async () => {
      settingsEnabled(85);
      const job = createMockJob();
      const storedMetrics: QualityMetrics = { vmaf: 92, calculatedAt: new Date() };

      jest
        .spyOn(
          service as unknown as {
            runPsnrPreGate: () => Promise<{ passed: boolean; psnr: number | null }>;
          },
          'runPsnrPreGate'
        )
        .mockResolvedValueOnce({ passed: true, psnr: 38 });

      const result = await service.checkQuality(job, outputPath, storedMetrics);

      expect(mockQualityMetricsService.calculateVmaf).not.toHaveBeenCalled();
      expect(result.score).toBe(92);
    });

    it('calls probeVmaf (calculateVmaf) when no stored score', async () => {
      settingsEnabled(85);
      const job = createMockJob();
      mockQualityMetricsService.calculateVmaf.mockResolvedValueOnce(87);

      jest
        .spyOn(
          service as unknown as {
            runPsnrPreGate: () => Promise<{ passed: boolean; psnr: number | null }>;
          },
          'runPsnrPreGate'
        )
        .mockResolvedValueOnce({ passed: true, psnr: 38 });

      const result = await service.checkQuality(job, outputPath, null);

      expect(mockQualityMetricsService.calculateVmaf).toHaveBeenCalledWith(
        job.filePath,
        outputPath
      );
      expect(result.score).toBe(87);
    });

    it('returns passed=true when VMAF score >= threshold', async () => {
      settingsEnabled(85);
      const job = createMockJob();
      mockQualityMetricsService.calculateVmaf.mockResolvedValueOnce(85);

      jest
        .spyOn(
          service as unknown as {
            runPsnrPreGate: () => Promise<{ passed: boolean; psnr: number | null }>;
          },
          'runPsnrPreGate'
        )
        .mockResolvedValueOnce({ passed: true, psnr: 38 });

      const result = await service.checkQuality(job, outputPath, null);

      expect(result.passed).toBe(true);
      expect(result.forcedPass).toBe(false);
      expect(result.score).toBe(85);
    });

    it('returns passed=false when VMAF score < threshold', async () => {
      settingsEnabled(85);
      const job = createMockJob();
      mockQualityMetricsService.calculateVmaf.mockResolvedValueOnce(72);

      jest
        .spyOn(
          service as unknown as {
            runPsnrPreGate: () => Promise<{ passed: boolean; psnr: number | null }>;
          },
          'runPsnrPreGate'
        )
        .mockResolvedValueOnce({ passed: true, psnr: 38 });

      const result = await service.checkQuality(job, outputPath, null);

      expect(result.passed).toBe(false);
      expect(result.forcedPass).toBe(false);
      expect(result.score).toBe(72);
    });

    it('force-passes with forcedPass=true when VMAF score is unavailable (libvmaf absent)', async () => {
      settingsEnabled(85);
      const job = createMockJob();
      mockQualityMetricsService.calculateVmaf.mockResolvedValueOnce(null);

      jest
        .spyOn(
          service as unknown as {
            runPsnrPreGate: () => Promise<{ passed: boolean; psnr: number | null }>;
          },
          'runPsnrPreGate'
        )
        .mockResolvedValueOnce({ passed: true, psnr: 38 });

      const result = await service.checkQuality(job, outputPath, null);

      expect(result.passed).toBe(true);
      expect(result.forcedPass).toBe(true);
      expect(result.score).toBeNull();
    });

    it('returns PSNR failure immediately when pre-gate fails', async () => {
      settingsEnabled(85);
      const job = createMockJob();

      jest
        .spyOn(
          service as unknown as {
            runPsnrPreGate: () => Promise<{ passed: boolean; psnr: number | null }>;
          },
          'runPsnrPreGate'
        )
        .mockResolvedValueOnce({ passed: false, psnr: 22 });

      const result = await service.checkQuality(job, outputPath, null);

      expect(result.passed).toBe(false);
      expect(result.score).toBe(22);
      expect(result.threshold).toBe(28);
      expect(mockQualityMetricsService.calculateVmaf).not.toHaveBeenCalled();
    });

    it('counts only lines starting with QUALITY_GATE_WARNING_PREFIX', async () => {
      settingsEnabled(85);
      // Two irrelevant warnings + two quality-gate retries (still < 3 → no force-pass)
      const warning = [
        'Some other warning',
        `${QUALITY_GATE_WARNING_PREFIX} retry 1`,
        'Another random warning',
        `${QUALITY_GATE_WARNING_PREFIX} retry 2`,
      ].join('\n');
      const job = createMockJob({ warning });
      mockQualityMetricsService.calculateVmaf.mockResolvedValueOnce(90);

      jest
        .spyOn(
          service as unknown as {
            runPsnrPreGate: () => Promise<{ passed: boolean; psnr: number | null }>;
          },
          'runPsnrPreGate'
        )
        .mockResolvedValueOnce({ passed: true, psnr: 38 });

      const result = await service.checkQuality(job, outputPath, null);

      expect(result.forcedPass).toBe(false);
      expect(result.passed).toBe(true);
    });
  });
});
