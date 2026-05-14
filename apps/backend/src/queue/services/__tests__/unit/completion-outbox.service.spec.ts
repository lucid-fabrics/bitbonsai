import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { promises as fsPromises } from 'fs';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { CompletionOutboxService, type CompletionPayload } from '../../completion-outbox.service';

let mockFsStat: jest.SpyInstance;

const makePayload = (overrides: Partial<CompletionPayload> = {}): CompletionPayload => ({
  outputPath: '/data/output/video.mkv',
  outputSizeBytes: 1_000_000,
  savedBytes: 500_000,
  savedPercent: 50,
  codec: 'hevc',
  ...overrides,
});

describe('CompletionOutboxService', () => {
  let service: CompletionOutboxService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    mockFsStat = jest.spyOn(fsPromises, 'stat');

    const module: TestingModule = await Test.createTestingModule({
      providers: [CompletionOutboxService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<CompletionOutboxService>(CompletionOutboxService);

    // Suppress logger output
    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // onModuleInit
  // ──────────────────────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('should call replayPendingCompletions on init', async () => {
      const replaySpy = jest.spyOn(service, 'replayPendingCompletions').mockResolvedValue(0);

      await service.onModuleInit();

      expect(replaySpy).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // writeOutbox
  // ──────────────────────────────────────────────────────────────────────────

  describe('writeOutbox', () => {
    it('should persist pendingCompletionData and pendingCompletionAt', async () => {
      const payload = makePayload();
      prisma.job.update.mockResolvedValue({});

      await service.writeOutbox('job-1', payload);

      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          pendingCompletionData: JSON.stringify(payload),
          pendingCompletionAt: expect.any(Date),
        },
      });
    });

    it('should propagate DB errors (not swallowed)', async () => {
      prisma.job.update.mockRejectedValue(new Error('DB write failed'));

      await expect(service.writeOutbox('job-1', makePayload())).rejects.toThrow('DB write failed');
    });

    it('should be idempotent: calling twice updates the same columns', async () => {
      const payload = makePayload();
      prisma.job.update.mockResolvedValue({});

      await service.writeOutbox('job-1', payload);
      await service.writeOutbox('job-1', payload);

      expect(prisma.job.update).toHaveBeenCalledTimes(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // clearOutbox
  // ──────────────────────────────────────────────────────────────────────────

  describe('clearOutbox', () => {
    it('should null out pendingCompletionData and pendingCompletionAt', async () => {
      prisma.job.update.mockResolvedValue({});

      await service.clearOutbox('job-1');

      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          pendingCompletionData: null,
          pendingCompletionAt: null,
        },
      });
    });

    it('should propagate DB errors', async () => {
      prisma.job.update.mockRejectedValue(new Error('DB clear failed'));

      await expect(service.clearOutbox('job-1')).rejects.toThrow('DB clear failed');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // replayPendingCompletions
  // ──────────────────────────────────────────────────────────────────────────

  describe('replayPendingCompletions', () => {
    it('should return 0 and not call update when no pending jobs', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      const count = await service.replayPendingCompletions();

      expect(count).toBe(0);
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('should query only non-COMPLETED jobs with pendingCompletionData set', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      await service.replayPendingCompletions();

      expect(prisma.job.findMany).toHaveBeenCalledWith({
        where: {
          pendingCompletionData: { not: null },
          stage: { not: JobStage.COMPLETED },
        },
        select: {
          id: true,
          fileLabel: true,
          pendingCompletionData: true,
          pendingCompletionAt: true,
        },
      });
    });

    it('should replay a valid completion and return count 1', async () => {
      const payload = makePayload();
      prisma.job.findMany.mockResolvedValue([
        {
          id: 'job-1',
          fileLabel: 'video.mkv',
          pendingCompletionData: JSON.stringify(payload),
          pendingCompletionAt: new Date(),
        },
      ]);
      mockFsStat.mockResolvedValue({} as any);
      prisma.job.update.mockResolvedValue({});

      const count = await service.replayPendingCompletions();

      expect(count).toBe(1);
      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1' },
          data: expect.objectContaining({
            stage: JobStage.COMPLETED,
            progress: 100,
            pendingCompletionData: null,
            pendingCompletionAt: null,
          }),
        })
      );
    });

    it('should reset to QUEUED when output file is missing', async () => {
      const payload = makePayload({ outputPath: '/data/missing.mkv' });
      prisma.job.findMany.mockResolvedValue([
        {
          id: 'job-2',
          fileLabel: 'missing.mkv',
          pendingCompletionData: JSON.stringify(payload),
          pendingCompletionAt: new Date(),
        },
      ]);
      mockFsStat.mockRejectedValue(new Error('ENOENT'));
      prisma.job.update.mockResolvedValue({});

      const count = await service.replayPendingCompletions();

      expect(count).toBe(0);
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-2' },
        data: {
          stage: JobStage.QUEUED,
          pendingCompletionData: null,
          pendingCompletionAt: null,
        },
      });
    });

    it('should reset to QUEUED when pendingCompletionData is malformed JSON', async () => {
      prisma.job.findMany.mockResolvedValue([
        {
          id: 'job-3',
          fileLabel: 'bad.mkv',
          pendingCompletionData: 'not-json{{',
          pendingCompletionAt: new Date(),
        },
      ]);
      prisma.job.update.mockResolvedValue({});

      const count = await service.replayPendingCompletions();

      expect(count).toBe(0);
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-3' },
        data: {
          stage: JobStage.QUEUED,
          pendingCompletionData: null,
          pendingCompletionAt: null,
        },
      });
      // fs.stat should NOT be called — short-circuits after JSON parse failure
      expect(mockFsStat).not.toHaveBeenCalled();
    });

    it('should continue replaying remaining jobs when one fails (best-effort)', async () => {
      const payload = makePayload();
      prisma.job.findMany.mockResolvedValue([
        {
          id: 'job-fail',
          fileLabel: 'fail.mkv',
          pendingCompletionData: JSON.stringify(payload),
          pendingCompletionAt: new Date(),
        },
        {
          id: 'job-ok',
          fileLabel: 'ok.mkv',
          pendingCompletionData: JSON.stringify(payload),
          pendingCompletionAt: new Date(),
        },
      ]);
      mockFsStat.mockResolvedValue({} as any);
      // First job throws on final update; second succeeds
      prisma.job.update.mockRejectedValueOnce(new Error('DB error')).mockResolvedValueOnce({});

      const count = await service.replayPendingCompletions();

      expect(count).toBe(1);
    });

    it('should return 0 without throwing when findMany fails (outer catch)', async () => {
      prisma.job.findMany.mockRejectedValue(new Error('connection lost'));

      const count = await service.replayPendingCompletions();

      expect(count).toBe(0);
    });

    it('should skip jobs where pendingCompletionData is null after findMany', async () => {
      // Edge case: race between query and another process clearing the field
      prisma.job.findMany.mockResolvedValue([
        {
          id: 'job-null',
          fileLabel: 'race.mkv',
          pendingCompletionData: null,
          pendingCompletionAt: new Date(),
        },
      ]);

      const count = await service.replayPendingCompletions();

      expect(count).toBe(0);
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('should correctly compute BigInt fields from payload numbers', async () => {
      const payload = makePayload({ outputSizeBytes: 1234567.89, savedBytes: 654321.12 });
      prisma.job.findMany.mockResolvedValue([
        {
          id: 'job-bigint',
          fileLabel: 'bigint.mkv',
          pendingCompletionData: JSON.stringify(payload),
          pendingCompletionAt: new Date(),
        },
      ]);
      mockFsStat.mockResolvedValue({} as any);
      prisma.job.update.mockResolvedValue({});

      await service.replayPendingCompletions();

      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            afterSizeBytes: BigInt(Math.round(1234567.89)),
            savedBytes: BigInt(Math.round(654321.12)),
          }),
        })
      );
    });
  });
});
