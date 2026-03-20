import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { JobMetricsService } from './job-metrics.service';

describe('JobMetricsService', () => {
  let service: JobMetricsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const baseJob = {
    id: 'job-1',
    nodeId: 'node-1',
    fileLabel: 'movie.mkv',
    savedBytes: BigInt(1073741824),
    fps: 25.0,
    node: { licenseId: 'license-abc' },
  };

  beforeEach(async () => {
    const prismaMock = {
      metricsProcessedJob: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      metric: {
        upsert: jest.fn(),
      },
      node: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [JobMetricsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<JobMetricsService>(JobMetricsService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updateMetrics', () => {
    it('should upsert metric and create processed-job record on success', async () => {
      prisma.metricsProcessedJob.findUnique.mockResolvedValue(null);
      prisma.metric.upsert.mockResolvedValue({} as never);
      prisma.node.findUnique.mockResolvedValue({ avgEncodingSpeed: 20.0 } as never);
      prisma.node.update.mockResolvedValue({} as never);
      prisma.metricsProcessedJob.create.mockResolvedValue({} as never);

      await service.updateMetrics(baseJob as never);

      expect(prisma.metric.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date_nodeId_licenseId: expect.objectContaining({
              nodeId: 'node-1',
              licenseId: 'license-abc',
            }),
          }),
        })
      );
      expect(prisma.metricsProcessedJob.create).toHaveBeenCalledWith({
        data: { jobId: 'job-1' },
      });
    });

    it('should skip processing when job was already processed (idempotency)', async () => {
      prisma.metricsProcessedJob.findUnique.mockResolvedValue({
        jobId: 'job-1',
        processedAt: new Date(),
      } as never);

      await service.updateMetrics(baseJob as never);

      expect(prisma.metric.upsert).not.toHaveBeenCalled();
      expect(prisma.metricsProcessedJob.create).not.toHaveBeenCalled();
    });

    it('should skip when job has no node licenseId', async () => {
      const jobWithoutLicense = { ...baseJob, node: undefined };

      await service.updateMetrics(jobWithoutLicense as never);

      expect(prisma.metricsProcessedJob.findUnique).not.toHaveBeenCalled();
      expect(prisma.metric.upsert).not.toHaveBeenCalled();
    });

    it('should update node avgEncodingSpeed when job has fps', async () => {
      prisma.metricsProcessedJob.findUnique.mockResolvedValue(null);
      prisma.metric.upsert.mockResolvedValue({} as never);
      prisma.node.findUnique.mockResolvedValue({ avgEncodingSpeed: 20.0 } as never);
      prisma.node.update.mockResolvedValue({} as never);
      prisma.metricsProcessedJob.create.mockResolvedValue({} as never);

      await service.updateMetrics({ ...baseJob, fps: 30.0 } as never);

      expect(prisma.node.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'node-1' },
          data: expect.objectContaining({ avgEncodingSpeed: expect.any(Number) }),
        })
      );
      // Exponential moving average: 20 * 0.7 + 30 * 0.3 = 23
      const updateCall = prisma.node.update.mock.calls[0][0] as {
        data: { avgEncodingSpeed: number };
      };
      expect(updateCall.data.avgEncodingSpeed).toBeCloseTo(23.0, 1);
    });

    it('should use fps as initial avgEncodingSpeed when node has no previous value', async () => {
      prisma.metricsProcessedJob.findUnique.mockResolvedValue(null);
      prisma.metric.upsert.mockResolvedValue({} as never);
      prisma.node.findUnique.mockResolvedValue({ avgEncodingSpeed: null } as never);
      prisma.node.update.mockResolvedValue({} as never);
      prisma.metricsProcessedJob.create.mockResolvedValue({} as never);

      await service.updateMetrics({ ...baseJob, fps: 25.0 } as never);

      const updateCall = prisma.node.update.mock.calls[0][0] as {
        data: { avgEncodingSpeed: number };
      };
      expect(updateCall.data.avgEncodingSpeed).toBe(25.0);
    });

    it('should skip node speed update when fps is 0', async () => {
      prisma.metricsProcessedJob.findUnique.mockResolvedValue(null);
      prisma.metric.upsert.mockResolvedValue({} as never);
      prisma.metricsProcessedJob.create.mockResolvedValue({} as never);

      await service.updateMetrics({ ...baseJob, fps: 0 } as never);

      expect(prisma.node.findUnique).not.toHaveBeenCalled();
      expect(prisma.node.update).not.toHaveBeenCalled();
    });

    it('should rethrow errors when called inside a transaction', async () => {
      prisma.metricsProcessedJob.findUnique.mockResolvedValue(null);
      prisma.metric.upsert.mockRejectedValue(new Error('DB constraint violation'));

      const txMock = {
        metricsProcessedJob: { findUnique: jest.fn().mockResolvedValue(null) },
        metric: { upsert: jest.fn().mockRejectedValue(new Error('DB constraint violation')) },
        node: { findUnique: jest.fn(), update: jest.fn() },
      } as unknown as Parameters<typeof service.updateMetrics>[1];

      await expect(service.updateMetrics(baseJob as never, txMock)).rejects.toThrow(
        'DB constraint violation'
      );
    });
  });
});
