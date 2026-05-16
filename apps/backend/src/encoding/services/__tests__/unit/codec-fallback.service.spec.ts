import { Test, type TestingModule } from '@nestjs/testing';
import type { Job } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockJob } from '../../../../testing/mock-factories';
import { CodecFallbackService } from '../../codec-fallback.service';

describe('CodecFallbackService', () => {
  let service: CodecFallbackService;
  let mockPrisma: { job: { update: jest.Mock } };

  beforeEach(async () => {
    mockPrisma = {
      job: { update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CodecFallbackService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CodecFallbackService>(CodecFallbackService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // shouldFallback
  // ---------------------------------------------------------------------------

  describe('shouldFallback()', () => {
    it('returns false when job.codecOverride is already set', () => {
      const job = createMockJob({ targetCodec: 'hevc_nvenc', codecOverride: 'libx265' });

      expect(service.shouldFallback(job, 'nvenc error occurred')).toBe(false);
    });

    it('returns false when targetCodec is not a GPU codec', () => {
      const job = createMockJob({ targetCodec: 'libx265', codecOverride: null });

      expect(service.shouldFallback(job, 'nvenc error occurred')).toBe(false);
    });

    it('returns false when error has no GPU keywords', () => {
      const job = createMockJob({ targetCodec: 'hevc_nvenc', codecOverride: null });

      expect(service.shouldFallback(job, 'disk full')).toBe(false);
    });

    it.each([
      ['nvenc', 'hevc_nvenc', 'nvenc initialization failed'],
      ['vaapi', 'hevc_vaapi', 'vaapi device open failed'],
      ['cuda', 'h264_nvenc', 'cuda context creation error'],
      ['nvcuvid', 'h264_nvenc', 'nvcuvid not available'],
      ['hwaccel', 'av1_nvenc', 'hwaccel not supported'],
      ['hw_frames_ctx', 'hevc_nvenc', 'hw_frames_ctx allocation failed'],
      ['no capable devices found', 'hevc_nvenc', 'no capable devices found'],
      ['device open failed', 'hevc_vaapi', 'device open failed'],
      ['cannot load nvcuda.dll', 'h264_nvenc', 'cannot load nvcuda.dll'],
      ['error initializing output stream', 'hevc_nvenc', 'error initializing output stream'],
      ['encoder not supported', 'av1_nvenc', 'encoder not supported'],
      ['failed querying', 'h264_nvenc', 'failed querying device capabilities'],
      ['vk_physical_device', 'hevc_nvenc', 'vk_physical_device selection failed'],
    ])(
      'returns true for GPU keyword "%s" on GPU codec %s',
      (_keyword: string, targetCodec: string, errorMessage: string) => {
        const job = createMockJob({ targetCodec, codecOverride: null } as Partial<Job>);

        expect(service.shouldFallback(job, errorMessage)).toBe(true);
      }
    );

    it('is case-insensitive for GPU error keywords', () => {
      const job = createMockJob({ targetCodec: 'hevc_nvenc', codecOverride: null });

      expect(service.shouldFallback(job, 'NVENC INITIALIZATION FAILED')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // applyFallback
  // ---------------------------------------------------------------------------

  describe('applyFallback()', () => {
    it('calls prisma.job.update with the correct cpuCodec for hevc_nvenc', async () => {
      mockPrisma.job.update.mockResolvedValueOnce({ gpuAttempts: 1 });

      await service.applyFallback('job-1', 'hevc_nvenc');

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          gpuAttempts: { increment: 1 },
          codecOverride: 'libx265',
        },
        select: { gpuAttempts: true },
      });
    });

    it.each([
      ['hevc_nvenc', 'libx265'],
      ['h264_nvenc', 'libx264'],
      ['hevc_vaapi', 'libx265'],
      ['h264_vaapi', 'libx264'],
      ['av1_nvenc', 'libsvtav1'],
    ])('maps %s → %s', async (gpuCodec: string, cpuCodec: string) => {
      mockPrisma.job.update.mockResolvedValueOnce({ gpuAttempts: 1 });

      await service.applyFallback('job-abc', gpuCodec);

      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ codecOverride: cpuCodec }),
        })
      );
    });

    it('throws when targetCodec has no CPU mapping', async () => {
      await expect(service.applyFallback('job-1', 'unknown_codec')).rejects.toThrow(
        'No CPU fallback mapping for codec "unknown_codec"'
      );

      expect(mockPrisma.job.update).not.toHaveBeenCalled();
    });

    it('does not call prisma.job.update when codec mapping is missing', async () => {
      await expect(service.applyFallback('job-1', 'libx265')).rejects.toThrow();

      expect(mockPrisma.job.update).not.toHaveBeenCalled();
    });

    it('logs the fallback codec after update', async () => {
      mockPrisma.job.update.mockResolvedValueOnce({ gpuAttempts: 2 });
      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

      await service.applyFallback('job-1', 'hevc_nvenc');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('libx265'));
    });
  });

  // ---------------------------------------------------------------------------
  // clearFallback
  // ---------------------------------------------------------------------------

  describe('clearFallback()', () => {
    it('calls prisma.job.update with codecOverride: null', async () => {
      mockPrisma.job.update.mockResolvedValueOnce({});

      await service.clearFallback('job-1');

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { codecOverride: null },
      });
    });

    it('passes the correct jobId', async () => {
      mockPrisma.job.update.mockResolvedValueOnce({});

      await service.clearFallback('job-xyz-999');

      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'job-xyz-999' } })
      );
    });
  });
});
