import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { FileSizeEstimationService } from '../../file-size-estimation.service';

describe('FileSizeEstimationService', () => {
  let service: FileSizeEstimationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileSizeEstimationService,
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                NODE_ENV: 'test',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<FileSizeEstimationService>(FileSizeEstimationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('estimateOutputSize', () => {
    it('should estimate HEVC output size with source bitrate', () => {
      const sourceSizeBytes = 4_500_000_000; // ~4.5 GB (matches 10Mbps for 1 hour)
      const sourceBitrateKbps = 10000; // 10 Mbps
      const durationSeconds = 3600; // 1 hour
      const targetCodec = 'HEVC';
      const qualityPreset = 'medium';
      const hwAccelType = 'CPU';

      const result = service.estimateOutputSize(
        sourceSizeBytes,
        sourceBitrateKbps,
        durationSeconds,
        targetCodec,
        qualityPreset,
        hwAccelType
      );

      expect(result).toBeDefined();
      expect(result.estimatedSizeFormatted).toBeDefined();
      // HEVC at medium = 50% ratio = 50% savings
      expect(result.savingsPercent).toBe(50);
      expect(result.confidence).toBe('high');
      expect(result.factors).toContain(`Source bitrate: ${sourceBitrateKbps} kbps`);
    });

    it('should estimate AV1 output size with medium preset', () => {
      const result = service.estimateOutputSize(2_000_000_000, null, 7200, 'AV1', 'slow', 'CPU');

      expect(result).toBeDefined();
      expect(result.savingsPercent).toBeGreaterThan(40); // AV1 typically 50-60%
      expect(result.confidence).toBe('medium');
    });

    it('should estimate with NVIDIA hardware acceleration', () => {
      const result = service.estimateOutputSize(
        1_500_000_000,
        15000,
        5400,
        'HEVC',
        'fast',
        'NVIDIA'
      );

      expect(result).toBeDefined();
      expect(result.factors).toContain('Hardware: NVIDIA');
      expect(result.savingsPercent).toBeLessThan(55); // Less compression due to NVENC overhead
    });

    it('should estimate VP9 output size', () => {
      const result = service.estimateOutputSize(500_000_000, null, 1800, 'VP9', 'medium', 'CPU');

      expect(result).toBeDefined();
      expect(result.savingsPercent).toBeGreaterThan(30);
    });

    it('should handle string source size', () => {
      const result = service.estimateOutputSize('1073741824', 8000, 3600, 'HEVC', 'medium', 'CPU');

      expect(result).toBeDefined();
      expect(result.confidence).toBe('high');
    });

    it('should handle Intel QSV hardware', () => {
      const result = service.estimateOutputSize(
        1_000_000_000,
        null,
        2700,
        'HEVC',
        'medium',
        'INTEL_QSV'
      );

      expect(result).toBeDefined();
      expect(result.factors).toContain('Hardware: INTEL_QSV');
    });

    it('should handle Apple Silicon', () => {
      const result = service.estimateOutputSize(
        800_000_000,
        null,
        1200,
        'HEVC',
        'medium',
        'APPLE_M'
      );

      expect(result).toBeDefined();
      expect(result.confidence).toBe('medium');
    });

    it('should handle H.264 (no compression)', () => {
      const result = service.estimateOutputSize(1_000_000_000, null, 3600, 'H264', 'medium', 'CPU');

      expect(result).toBeDefined();
      expect(result.savingsPercent).toBe(0);
    });

    it('should handle unknown codec with default ratio', () => {
      const result = service.estimateOutputSize(
        1_000_000_000,
        null,
        3600,
        'UNKNOWN',
        'medium',
        'CPU'
      );

      expect(result).toBeDefined();
      expect(result.savingsPercent).toBeGreaterThan(40); // Default 50%
    });

    it('should handle very fast preset', () => {
      const result = service.estimateOutputSize(
        1_000_000_000,
        null,
        3600,
        'HEVC',
        'veryFast',
        'CPU'
      );

      expect(result).toBeDefined();
      expect(result.factors).toContain('Quality preset: veryFast');
    });

    it('should handle verySlow preset', () => {
      const result = service.estimateOutputSize(
        1_000_000_000,
        null,
        3600,
        'HEVC',
        'verySlow',
        'CPU'
      );

      expect(result).toBeDefined();
      expect(result.savingsPercent).toBeGreaterThan(50);
    });

    it('should return high confidence when bitrate is provided', () => {
      const result = service.estimateOutputSize(1_000_000_000, 10000, 0, 'HEVC', 'medium', 'CPU');

      expect(result).toBeDefined();
      expect(result.confidence).toBe('high');
    });

    it('should cap savings at 95%', () => {
      const result = service.estimateOutputSize(100_000, 1000000, 1, 'AV1', 'verySlow', 'CPU');

      expect(result).toBeDefined();
      expect(result.savingsPercent).toBeLessThanOrEqual(95);
    });
  });

  describe('parseBitrate', () => {
    it('should parse megabit notation', () => {
      expect(service.parseBitrate('10.5M')).toBe(10500);
      expect(service.parseBitrate('5M')).toBe(5000);
    });

    it('should parse kilobit notation', () => {
      expect(service.parseBitrate('10000k')).toBe(10000);
      expect(service.parseBitrate('5000K')).toBe(5000);
    });

    it('should parse plain number', () => {
      expect(service.parseBitrate('8000')).toBe(8000);
      expect(service.parseBitrate('8000000')).toBe(8000); // 8M bits = 8000 kbps
    });

    it('should return null for empty string', () => {
      expect(service.parseBitrate('')).toBeNull();
      expect(service.parseBitrate('  ')).toBeNull();
    });

    it('should return null for invalid input', () => {
      expect(service.parseBitrate('invalid')).toBeNull();
      expect(service.parseBitrate('xyz')).toBeNull();
    });
  });

  describe('getCompressionRatio', () => {
    it('should return correct ratios', () => {
      expect(service.getCompressionRatio('HEVC')).toBe(0.5);
      expect(service.getCompressionRatio('AV1')).toBe(0.4);
      expect(service.getCompressionRatio('VP9')).toBe(0.55);
      expect(service.getCompressionRatio('H264')).toBe(1.0);
    });

    it('should return default ratio for unknown codec', () => {
      expect(service.getCompressionRatio('UNKNOWN')).toBe(0.5);
    });
  });

  describe('getTypicalSavings', () => {
    it('should return correct savings percentages', () => {
      expect(service.getTypicalSavings('HEVC')).toBe(50);
      expect(service.getTypicalSavings('AV1')).toBe(60);
      expect(service.getTypicalSavings('VP9')).toBe(45);
      expect(service.getTypicalSavings('H264')).toBe(0);
    });

    it('should return default savings for unknown codec', () => {
      expect(service.getTypicalSavings('UNKNOWN')).toBe(50);
    });
  });
});
