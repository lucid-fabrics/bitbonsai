import { Test, TestingModule } from '@nestjs/testing';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueStartupHealingService } from './queue-startup-healing.service';

describe('QueueStartupHealingService', () => {
  let service: QueueStartupHealingService;
  let mockPrisma: any;
  let mockNodeConfig: jest.Mocked<NodeConfigService>;
  let mockJobRepository: { updateById: jest.Mock; findManyWithInclude: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      policy: { findMany: jest.fn().mockResolvedValue([]) },
      job: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    mockNodeConfig = {
      getMainApiUrl: jest.fn().mockReturnValue(null),
      getNodeId: jest.fn().mockReturnValue(null),
      isMainNode: jest.fn().mockReturnValue(true),
    } as any;

    mockJobRepository = {
      updateById: jest.fn(),
      findManyWithInclude: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueStartupHealingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: NodeConfigService, useValue: mockNodeConfig },
      ],
    }).compile();

    service = module.get<QueueStartupHealingService>(QueueStartupHealingService);
  });

  describe('onModuleInit', () => {
    it('should skip healing on linked node', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000/api/v1');

      await service.onModuleInit();

      expect(mockPrisma.policy.findMany).not.toHaveBeenCalled();
    });

    it('should run healing scan on main node', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockPrisma.policy.findMany.mockResolvedValue([
        { id: 'p1', targetCodec: 'hevc', name: 'Default' },
      ]);

      await service.onModuleInit();

      expect(mockPrisma.policy.findMany).toHaveBeenCalled();
    });
  });

  describe('onModuleInit - policy healing', () => {
    it('should heal codec mismatch for jobs with existing policy', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockPrisma.policy.findMany.mockResolvedValue([
        { id: 'p1', targetCodec: 'hevc', name: 'Default' },
      ]);
      mockJobRepository.updateById.mockResolvedValue({});
      mockJobRepository.findManyWithInclude.mockResolvedValue([
        {
          id: 'job-mismatch',
          policyId: 'p1',
          targetCodec: 'h264',
          library: { nodeId: 'node-1', defaultPolicy: null, policies: [] },
        },
      ]);

      await service.onModuleInit();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-mismatch',
        expect.objectContaining({ targetCodec: 'hevc' })
      );
    });

    it('should assign policy from library default when job has no policy', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockPrisma.policy.findMany.mockResolvedValue([
        { id: 'p1', targetCodec: 'hevc', name: 'Default' },
      ]);
      mockJobRepository.updateById.mockResolvedValue({});
      mockJobRepository.findManyWithInclude.mockResolvedValue([
        {
          id: 'job-orphan',
          policyId: null,
          targetCodec: 'hevc',
          library: {
            nodeId: 'node-1',
            defaultPolicy: { id: 'p1', targetCodec: 'hevc', name: 'Default' },
            policies: [{ id: 'p1', targetCodec: 'hevc', name: 'Default' }],
          },
        },
      ]);

      await service.onModuleInit();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-orphan',
        expect.objectContaining({ policyId: 'p1' })
      );
    });

    it('should warn and skip when no policies exist', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockPrisma.policy.findMany.mockResolvedValue([]);

      await service.onModuleInit();

      expect(mockJobRepository.findManyWithInclude).not.toHaveBeenCalled();
    });

    it('should use first available policy when library has no policies', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockPrisma.policy.findMany.mockResolvedValue([
        { id: 'p-fallback', targetCodec: 'av1', name: 'Fallback' },
      ]);
      mockJobRepository.updateById.mockResolvedValue({});
      mockJobRepository.findManyWithInclude.mockResolvedValue([
        {
          id: 'job-no-library',
          policyId: null,
          targetCodec: 'h264',
          library: { nodeId: 'node-1', defaultPolicy: null, policies: [] },
        },
      ]);

      await service.onModuleInit();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-no-library',
        expect.objectContaining({ policyId: 'p-fallback' })
      );
    });

    it('should handle individual job healing errors without stopping the loop', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockPrisma.policy.findMany.mockResolvedValue([
        { id: 'p1', targetCodec: 'hevc', name: 'Default' },
      ]);
      mockJobRepository.updateById
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValue({});
      mockJobRepository.findManyWithInclude.mockResolvedValue([
        {
          id: 'job-error',
          policyId: 'p1',
          targetCodec: 'h264',
          library: { nodeId: 'node-1', defaultPolicy: null, policies: [] },
        },
        {
          id: 'job-good',
          policyId: 'p1',
          targetCodec: 'hevc',
          library: { nodeId: 'node-1', defaultPolicy: null, policies: [] },
        },
      ]);

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });
});
