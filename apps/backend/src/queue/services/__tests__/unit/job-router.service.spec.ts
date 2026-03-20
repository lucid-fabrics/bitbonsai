import { Test, type TestingModule } from '@nestjs/testing';
import { NetworkLocation } from '@prisma/client';
import { JobRepository } from '../../../../common/repositories/job.repository';
import { NodeRepository } from '../../../../common/repositories/node.repository';
import { JobRouterService } from '../../job-router.service';

describe('JobRouterService', () => {
  let service: JobRouterService;
  let nodeRepository: { findManySelect: jest.Mock };
  let jobRepository: { findManySelect: jest.Mock; updateById: jest.Mock };

  beforeEach(async () => {
    nodeRepository = { findManySelect: jest.fn() };
    jobRepository = { findManySelect: jest.fn(), updateById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobRouterService,
        { provide: NodeRepository, useValue: nodeRepository },
        { provide: JobRepository, useValue: jobRepository },
      ],
    }).compile();

    service = module.get<JobRouterService>(JobRouterService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  const createNode = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: `node-${id}`,
    role: 'WORKER',
    networkLocation: NetworkLocation.LOCAL,
    hasSharedStorage: true,
    maxWorkers: 4,
    maxTransferSizeMB: 50000,
    latencyMs: 1,
    _count: { jobs: 0 },
    ...overrides,
  });

  describe('findBestNodeForJob', () => {
    it('should return null when no online nodes exist', async () => {
      nodeRepository.findManySelect.mockResolvedValue([]);

      const result = await service.findBestNodeForJob('job-1', BigInt(1000000));

      expect(result).toBeNull();
      expect((service as any).logger.warn).toHaveBeenCalledWith('No online nodes available');
    });

    it('should prefer LOCAL node with shared storage (highest score)', async () => {
      const nodes = [
        createNode('local-shared', {
          networkLocation: NetworkLocation.LOCAL,
          hasSharedStorage: true,
        }),
        createNode('local-no-share', {
          networkLocation: NetworkLocation.LOCAL,
          hasSharedStorage: false,
        }),
        createNode('remote', {
          networkLocation: NetworkLocation.REMOTE,
          hasSharedStorage: false,
        }),
      ];
      nodeRepository.findManySelect.mockResolvedValue(nodes);

      const result = await service.findBestNodeForJob('job-1', BigInt(1000000));

      expect(result).toBe('local-shared');
    });

    it('should prefer LOCAL node without shared storage over REMOTE', async () => {
      const nodes = [
        createNode('local', {
          networkLocation: NetworkLocation.LOCAL,
          hasSharedStorage: false,
        }),
        createNode('remote', {
          networkLocation: NetworkLocation.REMOTE,
          hasSharedStorage: false,
        }),
      ];
      nodeRepository.findManySelect.mockResolvedValue(nodes);

      const result = await service.findBestNodeForJob('job-1', BigInt(1000000));

      expect(result).toBe('local');
    });

    it('should penalize nodes with high active job load', async () => {
      const nodes = [
        createNode('busy', {
          networkLocation: NetworkLocation.LOCAL,
          hasSharedStorage: true,
          maxWorkers: 4,
          _count: { jobs: 3 }, // 75% load = -150 penalty, but NOT at capacity (3 < 4)
        }),
        createNode('idle', {
          networkLocation: NetworkLocation.LOCAL,
          hasSharedStorage: true,
          maxWorkers: 4,
          _count: { jobs: 0 }, // 0% load = no penalty
        }),
      ];
      nodeRepository.findManySelect.mockResolvedValue(nodes);

      const result = await service.findBestNodeForJob('job-1', BigInt(1000000));

      // busy: 1000 - 150 = 850 (both have shared storage, but busy has load penalty)
      // idle: 1000 - 0 = 1000
      // idle wins because it has no load penalty
      expect(result).toBe('idle');
    });

    it('should exclude nodes at capacity', async () => {
      const nodes = [
        createNode('full', {
          networkLocation: NetworkLocation.LOCAL,
          hasSharedStorage: true,
          maxWorkers: 2,
          _count: { jobs: 2 }, // At capacity
        }),
        createNode('available', {
          networkLocation: NetworkLocation.REMOTE,
          hasSharedStorage: false,
          maxWorkers: 4,
          _count: { jobs: 1 },
        }),
      ];
      nodeRepository.findManySelect.mockResolvedValue(nodes);

      const result = await service.findBestNodeForJob('job-1', BigInt(1000000));

      expect(result).toBe('available');
    });

    it('should exclude nodes when file exceeds transfer limit', async () => {
      const fileSizeBytes = BigInt(60000 * 1024 * 1024); // 60GB in bytes
      const nodes = [
        createNode('small-limit', {
          networkLocation: NetworkLocation.LOCAL,
          hasSharedStorage: true,
          maxTransferSizeMB: 50000, // 50GB limit
        }),
        createNode('big-limit', {
          networkLocation: NetworkLocation.LOCAL,
          hasSharedStorage: false,
          maxTransferSizeMB: 100000, // 100GB limit
        }),
      ];
      nodeRepository.findManySelect.mockResolvedValue(nodes);

      const result = await service.findBestNodeForJob('job-1', fileSizeBytes);

      expect(result).toBe('big-limit');
    });

    it('should return null when all nodes are at capacity', async () => {
      const nodes = [
        createNode('full-1', {
          maxWorkers: 2,
          _count: { jobs: 2 },
        }),
        createNode('full-2', {
          maxWorkers: 1,
          _count: { jobs: 1 },
        }),
      ];
      nodeRepository.findManySelect.mockResolvedValue(nodes);

      const result = await service.findBestNodeForJob('job-1', BigInt(1000000));

      expect(result).toBeNull();
      expect((service as any).logger.warn).toHaveBeenCalledWith('No node can handle this job');
    });

    it('should penalize large file + remote node combination', async () => {
      const largeFileSize = BigInt(11 * 1024 * 1024 * 1024); // 11GB
      const nodes = [
        createNode('remote', {
          networkLocation: NetworkLocation.REMOTE,
          hasSharedStorage: false,
          maxWorkers: 10,
          maxTransferSizeMB: 100000,
          _count: { jobs: 0 },
        }),
      ];
      nodeRepository.findManySelect.mockResolvedValue(nodes);

      const result = await service.findBestNodeForJob('job-1', largeFileSize);

      // Score: 100 (remote) - 0 (no load) - 300 (large+remote) = -200
      // Still selected because it's the only node that can handle it
      expect(result).toBe('remote');
    });

    it('should handle zero maxWorkers gracefully (prevent division by zero)', async () => {
      const nodes = [
        createNode('zero-workers', {
          maxWorkers: 0,
          _count: { jobs: 0 },
        }),
      ];
      nodeRepository.findManySelect.mockResolvedValue(nodes);

      // Should not throw
      const result = await service.findBestNodeForJob('job-1', BigInt(1000000));

      // Node at capacity since 0 >= 0
      expect(result).toBeNull();
    });

    it('should log scoring results for each node', async () => {
      const nodes = [
        createNode('node-a', {
          networkLocation: NetworkLocation.LOCAL,
          hasSharedStorage: true,
          _count: { jobs: 1 },
        }),
      ];
      nodeRepository.findManySelect.mockResolvedValue(nodes);

      await service.findBestNodeForJob('job-1', BigInt(1000000));

      expect((service as any).logger.log).toHaveBeenCalledWith('Node scoring results:');
      expect((service as any).logger.log).toHaveBeenCalledWith(
        expect.stringContaining('node-node-a')
      );
    });

    it('should handle small file with remote node (no large file penalty)', async () => {
      const smallFileSize = BigInt(5 * 1024 * 1024 * 1024); // 5GB (under 10GB threshold)
      const nodes = [
        createNode('remote', {
          networkLocation: NetworkLocation.REMOTE,
          hasSharedStorage: false,
          maxWorkers: 4,
          maxTransferSizeMB: 100000,
          _count: { jobs: 0 },
        }),
      ];
      nodeRepository.findManySelect.mockResolvedValue(nodes);

      const result = await service.findBestNodeForJob('job-1', smallFileSize);

      expect(result).toBe('remote');
    });
  });

  describe('rebalanceJobs', () => {
    it('should return 0 when fewer than 2 nodes exist', async () => {
      nodeRepository.findManySelect.mockResolvedValue([
        createNode('only-node', { _count: { jobs: 10 } }),
      ]);

      const result = await service.rebalanceJobs();

      expect(result).toBe(0);
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'Not enough nodes for rebalancing (need at least 2)'
      );
    });

    it('should return 0 when no nodes are overloaded', async () => {
      nodeRepository.findManySelect.mockResolvedValue([
        createNode('balanced-1', { maxWorkers: 10, _count: { jobs: 5 } }), // 50%
        createNode('balanced-2', { maxWorkers: 10, _count: { jobs: 3 } }), // 30%
      ]);

      const result = await service.rebalanceJobs();

      expect(result).toBe(0);
      expect((service as any).logger.log).toHaveBeenCalledWith(
        expect.stringContaining('No rebalancing needed')
      );
    });

    it('should return 0 when all nodes are overloaded (no underutilized target)', async () => {
      nodeRepository.findManySelect.mockResolvedValue([
        createNode('busy-1', { maxWorkers: 4, _count: { jobs: 20 } }), // 500%
        createNode('busy-2', { maxWorkers: 5, _count: { jobs: 15 } }), // 300%
      ]);

      const result = await service.rebalanceJobs();

      expect(result).toBe(0);
    });

    it('should move jobs from overloaded to underutilized nodes', async () => {
      nodeRepository.findManySelect.mockResolvedValue([
        createNode('overloaded', { maxWorkers: 4, _count: { jobs: 20 } }), // 500%
        createNode('idle', { maxWorkers: 5, _count: { jobs: 1 } }), // 20%
      ]);

      const jobsToMove = [
        { id: 'job-1', fileLabel: 'movie1.mkv' },
        { id: 'job-2', fileLabel: 'movie2.mkv' },
        { id: 'job-3', fileLabel: 'movie3.mkv' },
      ];
      jobRepository.findManySelect.mockResolvedValue(jobsToMove);
      jobRepository.updateById.mockResolvedValue({});

      const result = await service.rebalanceJobs();

      expect(result).toBe(3);
      expect(jobRepository.updateById).toHaveBeenCalledTimes(3);
      expect(jobRepository.updateById).toHaveBeenCalledWith('job-1', { nodeId: 'idle' });
    });

    it('should limit batch size to 5 jobs per overloaded node', async () => {
      nodeRepository.findManySelect.mockResolvedValue([
        createNode('overloaded', { maxWorkers: 2, _count: { jobs: 50 } }),
        createNode('idle', { maxWorkers: 10, _count: { jobs: 0 } }),
      ]);

      jobRepository.findManySelect.mockResolvedValue([
        { id: 'j1', fileLabel: '1.mkv' },
        { id: 'j2', fileLabel: '2.mkv' },
        { id: 'j3', fileLabel: '3.mkv' },
        { id: 'j4', fileLabel: '4.mkv' },
        { id: 'j5', fileLabel: '5.mkv' },
      ]);
      jobRepository.updateById.mockResolvedValue({});

      const result = await service.rebalanceJobs();

      expect(result).toBe(5);
      // findManySelect returns all, service slices to 5 internally
      expect(jobRepository.findManySelect).toHaveBeenCalled();
    });

    it('should distribute jobs round-robin across multiple underutilized nodes', async () => {
      nodeRepository.findManySelect.mockResolvedValue([
        createNode('overloaded', { maxWorkers: 2, _count: { jobs: 10 } }), // 500%
        createNode('idle-1', { maxWorkers: 10, _count: { jobs: 1 } }), // 10%
        createNode('idle-2', { maxWorkers: 10, _count: { jobs: 2 } }), // 20%
      ]);

      jobRepository.findManySelect.mockResolvedValue([
        { id: 'j1', fileLabel: '1.mkv' },
        { id: 'j2', fileLabel: '2.mkv' },
        { id: 'j3', fileLabel: '3.mkv' },
        { id: 'j4', fileLabel: '4.mkv' },
      ]);
      jobRepository.updateById.mockResolvedValue({});

      const result = await service.rebalanceJobs();

      expect(result).toBe(4);

      // Verify round-robin distribution
      const updateCalls = jobRepository.updateById.mock.calls;
      // Jobs alternate between idle-1 and idle-2
      expect(updateCalls[0][1].nodeId).not.toBe(updateCalls[1][1].nodeId);
    });

    it('should only consider LOCAL nodes for rebalancing', async () => {
      nodeRepository.findManySelect.mockResolvedValue([]);

      await service.rebalanceJobs();

      expect(nodeRepository.findManySelect).toHaveBeenCalledWith(
        {
          status: 'ONLINE',
          networkLocation: NetworkLocation.LOCAL,
        },
        expect.objectContaining({
          id: true,
          name: true,
          maxWorkers: true,
        })
      );
    });

    it('should only move QUEUED jobs', async () => {
      nodeRepository.findManySelect.mockResolvedValue([
        createNode('overloaded', { maxWorkers: 2, _count: { jobs: 10 } }),
        createNode('idle', { maxWorkers: 10, _count: { jobs: 0 } }),
      ]);

      jobRepository.findManySelect.mockResolvedValue([]);

      await service.rebalanceJobs();

      expect(jobRepository.findManySelect).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'QUEUED' }),
        expect.anything()
      );
    });

    it('should log rebalance results', async () => {
      nodeRepository.findManySelect.mockResolvedValue([
        createNode('overloaded', { maxWorkers: 2, _count: { jobs: 10 } }),
        createNode('idle', { maxWorkers: 10, _count: { jobs: 0 } }),
      ]);
      jobRepository.findManySelect.mockResolvedValue([{ id: 'j1', fileLabel: 'test.mkv' }]);
      jobRepository.updateById.mockResolvedValue({});

      await service.rebalanceJobs();

      expect((service as any).logger.log).toHaveBeenCalledWith(
        expect.stringContaining('Rebalanced 1 job(s)')
      );
      expect((service as any).logger.log).toHaveBeenCalledWith(
        expect.stringContaining('Moved job test.mkv')
      );
    });

    it('should handle empty job list from overloaded node', async () => {
      nodeRepository.findManySelect.mockResolvedValue([
        createNode('overloaded', { maxWorkers: 2, _count: { jobs: 10 } }),
        createNode('idle', { maxWorkers: 10, _count: { jobs: 0 } }),
      ]);
      jobRepository.findManySelect.mockResolvedValue([]); // No queued jobs despite being "overloaded" by count

      const result = await service.rebalanceJobs();

      expect(result).toBe(0);
    });
  });

  describe('formatBytes (private, tested indirectly)', () => {
    it('should format bytes in log output for findBestNodeForJob', async () => {
      nodeRepository.findManySelect.mockResolvedValue([]);

      await service.findBestNodeForJob('job-1', BigInt(0));

      expect((service as any).logger.log).toHaveBeenCalledWith(expect.stringContaining('0 Bytes'));
    });

    it('should format GB sizes correctly', async () => {
      nodeRepository.findManySelect.mockResolvedValue([]);
      const twoGB = BigInt(2 * 1024 * 1024 * 1024);

      await service.findBestNodeForJob('job-1', twoGB);

      expect((service as any).logger.log).toHaveBeenCalledWith(expect.stringContaining('2.00 GB'));
    });
  });
});
