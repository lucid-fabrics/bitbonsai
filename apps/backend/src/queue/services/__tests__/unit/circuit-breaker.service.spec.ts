import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { CircuitBreakerService } from '../../circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitBreakerService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);

    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('checkAndBreak', () => {
    it('should return false when job not found (P2025 error)', async () => {
      const p2025Error = new Prisma.PrismaClientKnownRequestError('Record to update not found', {
        code: 'P2025',
        clientVersion: '1.0.0',
      });
      prisma.job.update.mockRejectedValue(p2025Error);

      const result = await service.checkAndBreak('non-existent-id', 'test-reason');

      expect(result).toBe(false);
      expect(prisma.job.update).toHaveBeenCalledTimes(1);
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'non-existent-id' },
        data: { totalAttempts: { increment: 1 } },
        select: { totalAttempts: true, circuitBroken: true, fileLabel: true },
      });
    });

    it('should return false when totalAttempts becomes 5 after increment', async () => {
      prisma.job.update.mockResolvedValue({
        totalAttempts: 5,
        circuitBroken: false,
        fileLabel: 'test.mkv',
      });

      const result = await service.checkAndBreak('job-1', 'test-reason');

      expect(result).toBe(false);
      expect(prisma.job.update).toHaveBeenCalledTimes(1);
      expect((service as any).logger.debug).toHaveBeenCalledWith(
        'Circuit check: test.mkv — attempt 5/10'
      );
    });

    it('should break circuit when totalAttempts becomes exactly 10 after increment', async () => {
      prisma.job.update.mockResolvedValueOnce({
        totalAttempts: 10,
        circuitBroken: false,
        fileLabel: 'test.mkv',
      });
      prisma.job.update.mockResolvedValue({});

      const result = await service.checkAndBreak('job-1', 'exceeded-threshold');

      expect(result).toBe(true);
      expect(prisma.job.update).toHaveBeenCalledTimes(2);

      // First call: increment totalAttempts
      expect(prisma.job.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'job-1' },
        data: { totalAttempts: { increment: 1 } },
        select: { totalAttempts: true, circuitBroken: true, fileLabel: true },
      });

      // Second call: set circuit broken fields
      expect(prisma.job.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'job-1' },
        data: {
          circuitBroken: true,
          circuitBrokenAt: expect.any(Date),
          circuitBrokenReason: 'exceeded-threshold',
          dlqEnteredAt: expect.any(Date),
          stage: JobStage.FAILED,
          failedAt: expect.any(Date),
          error: expect.stringContaining(
            'Circuit broken after 10 total attempts: exceeded-threshold'
          ),
        },
      });

      expect((service as any).logger.warn).toHaveBeenCalledWith(
        '✗ Circuit broken: test.mkv (10 total attempts) — exceeded-threshold → FAILED permanently'
      );
    });

    it('should store reason string in circuitBrokenReason field', async () => {
      prisma.job.update.mockResolvedValueOnce({
        totalAttempts: 10,
        circuitBroken: false,
        fileLabel: 'flaky-video.mkv',
      });
      prisma.job.update.mockResolvedValue({});

      await service.checkAndBreak('job-1', 'stuck-recovery repeated failures');

      // Verify the reason is stored in the second update
      const secondCall = prisma.job.update.mock.calls[1];
      expect(secondCall[0].data.circuitBrokenReason).toBe('stuck-recovery repeated failures');
    });

    it('should return false when prisma throws any error (catch-all swallow)', async () => {
      const connectionError = new Error('Database connection lost');
      prisma.job.update.mockRejectedValue(connectionError);

      // Implementation uses .catch(() => null) — all errors return false, not throw
      const result = await service.checkAndBreak('job-1', 'test-reason');
      expect(result).toBe(false);
    });
  });

  describe('isCircuitBroken', () => {
    it('should return true when job circuit is broken', async () => {
      prisma.job.findUnique.mockResolvedValue({ circuitBroken: true });

      const result = await service.isCircuitBroken('job-1');

      expect(result).toBe(true);
      expect(prisma.job.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        select: { circuitBroken: true },
      });
    });

    it('should return false when job circuit is not broken', async () => {
      prisma.job.findUnique.mockResolvedValue({ circuitBroken: false });

      const result = await service.isCircuitBroken('job-1');

      expect(result).toBe(false);
    });

    it('should return false when job is not found', async () => {
      prisma.job.findUnique.mockResolvedValue(null);

      const result = await service.isCircuitBroken('non-existent-id');

      expect(result).toBe(false);
    });
  });
});
