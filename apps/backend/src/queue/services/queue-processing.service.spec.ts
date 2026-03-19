import { HttpService } from '@nestjs/axios';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeRepository } from '../../common/repositories/node.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { MediaAnalysisService } from '../../libraries/services/media-analysis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FileTransferService } from './file-transfer.service';
import { JobRouterService } from './job-router.service';
import { QueueJobCrudService } from './queue-job-crud.service';
import { QueueProcessingService } from './queue-processing.service';

describe('QueueProcessingService', () => {
  let service: QueueProcessingService;
  let mockPrisma: any;
  let mockMediaAnalysis: jest.Mocked<MediaAnalysisService>;
  let mockFfmpegService: jest.Mocked<FfmpegService>;
  let mockJobRouterService: jest.Mocked<JobRouterService>;
  let mockFileTransferService: jest.Mocked<FileTransferService>;
  let mockNodeConfig: jest.Mocked<NodeConfigService>;
  let mockJobCrudService: jest.Mocked<QueueJobCrudService>;
  let mockJobRepository: { updateById: jest.Mock };
  let mockNodeRepository: { findById: jest.Mock; findUnique: jest.Mock };
  let mockHttpService: { get: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      policy: { findMany: jest.fn().mockResolvedValue([]) },
      job: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), update: jest.fn() },
      node: { findUnique: jest.fn() },
      library: { findUnique: jest.fn() },
      $transaction: jest.fn(),
      $executeRaw: jest.fn(),
    };

    mockMediaAnalysis = {
      probeVideoFile: jest.fn(),
    } as any;

    mockFfmpegService = {
      getVideoInfoCached: jest.fn(),
    } as any;

    mockJobRouterService = {
      findBestNodeForJob: jest.fn().mockResolvedValue(null),
    } as any;

    mockFileTransferService = {
      transferFile: jest.fn(),
    } as any;

    mockNodeConfig = {
      getMainApiUrl: jest.fn().mockReturnValue(null),
    } as any;

    mockJobCrudService = {
      create: jest.fn(),
    } as any;

    mockJobRepository = { updateById: jest.fn() };
    mockNodeRepository = { findById: jest.fn(), findUnique: jest.fn() };
    mockHttpService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueProcessingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: NodeRepository, useValue: mockNodeRepository },
        { provide: MediaAnalysisService, useValue: mockMediaAnalysis },
        { provide: FfmpegService, useValue: mockFfmpegService },
        { provide: JobRouterService, useValue: mockJobRouterService },
        { provide: FileTransferService, useValue: mockFileTransferService },
        { provide: NodeConfigService, useValue: mockNodeConfig },
        { provide: HttpService, useValue: mockHttpService },
        { provide: QueueJobCrudService, useValue: mockJobCrudService },
      ],
    }).compile();

    service = module.get<QueueProcessingService>(QueueProcessingService);
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
      mockPrisma.job.findMany.mockResolvedValue([]);

      await service.onModuleInit();

      expect(mockPrisma.policy.findMany).toHaveBeenCalled();
    });
  });

  describe('getNextJob', () => {
    it('should throw NotFoundException when node not found', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue(null);

      await expect(service.getNextJob('missing-node')).rejects.toThrow(NotFoundException);
    });

    it('should return null when node is at capacity', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue({
        id: 'node-1',
        hasSharedStorage: true,
        license: { maxConcurrentJobs: 2 },
        _count: { jobs: 2 },
      });

      const result = await service.getNextJob('node-1');
      expect(result).toBeNull();
    });

    it('should proxy to main API on linked node', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000/api/v1');
      const job = { id: 'job-1', fileLabel: 'movie.mkv' };
      const { of } = await import('rxjs');
      mockHttpService.get.mockReturnValue(of({ data: job }));

      const result = await service.getNextJob('node-1');
      expect(result).toEqual(job);
    });
  });

  describe('handleFileDetected', () => {
    it('should skip job creation when library not found', async () => {
      mockPrisma.library.findUnique.mockResolvedValue(null);

      await service.handleFileDetected({
        libraryId: 'missing-lib',
        filePath: '/media/movie.mkv',
        fileName: 'movie.mkv',
      });

      expect(mockJobCrudService.create).not.toHaveBeenCalled();
    });

    it('should skip when library has no default policy', async () => {
      mockPrisma.library.findUnique.mockResolvedValue({
        id: 'lib-1',
        name: 'Movies',
        nodeId: 'node-1',
        defaultPolicyId: null,
        defaultPolicy: null,
      });

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie.mkv',
        fileName: 'movie.mkv',
      });

      expect(mockJobCrudService.create).not.toHaveBeenCalled();
    });

    it('should create job for detected file', async () => {
      mockPrisma.library.findUnique.mockResolvedValue({
        id: 'lib-1',
        name: 'Movies',
        nodeId: 'node-1',
        defaultPolicyId: 'policy-1',
        defaultPolicy: {
          id: 'policy-1',
          targetCodec: 'hevc',
          targetContainer: 'mkv',
          skipReencoding: true,
        },
      });
      mockMediaAnalysis.probeVideoFile.mockResolvedValue({
        codec: 'h264',
        duration: 3600,
        sizeBytes: 1000000000,
      } as any);
      mockFfmpegService.getVideoInfoCached.mockResolvedValue({
        codec: 'h264',
        container: 'mkv',
      } as any);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1', hasSharedStorage: false });
      mockJobCrudService.create.mockResolvedValue({ id: 'job-1' } as any);

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie.mkv',
        fileName: 'movie.mkv',
      });

      expect(mockJobCrudService.create).toHaveBeenCalled();
    });

    it('should skip when probeVideoFile returns null', async () => {
      mockPrisma.library.findUnique.mockResolvedValue({
        id: 'lib-1',
        name: 'Movies',
        nodeId: 'node-1',
        defaultPolicyId: 'policy-1',
        defaultPolicy: {
          id: 'policy-1',
          targetCodec: 'hevc',
          targetContainer: 'mkv',
          skipReencoding: false,
        },
      });
      mockMediaAnalysis.probeVideoFile.mockResolvedValue(null);

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie.mkv',
        fileName: 'movie.mkv',
      });

      expect(mockJobCrudService.create).not.toHaveBeenCalled();
    });

    it('should skip encoding when codec matches, skipReencoding=true and containers match', async () => {
      mockPrisma.library.findUnique.mockResolvedValue({
        id: 'lib-1',
        name: 'Movies',
        nodeId: 'node-1',
        defaultPolicyId: 'policy-1',
        defaultPolicy: {
          id: 'policy-1',
          targetCodec: 'hevc',
          targetContainer: 'mkv',
          skipReencoding: true,
        },
      });
      mockMediaAnalysis.probeVideoFile.mockResolvedValue({
        codec: 'hevc',
        duration: 3600,
        sizeBytes: 1000000000,
      } as any);
      mockFfmpegService.getVideoInfoCached.mockResolvedValue({
        codec: 'hevc',
        container: 'mkv', // same container
      } as any);

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie.mkv',
        fileName: 'movie.mkv',
      });

      // Should return early without creating a job
      expect(mockJobCrudService.create).not.toHaveBeenCalled();
    });

    it('should create REMUX job when codec matches but containers differ and skipReencoding=true', async () => {
      mockPrisma.library.findUnique.mockResolvedValue({
        id: 'lib-1',
        name: 'Movies',
        nodeId: 'node-1',
        defaultPolicyId: 'policy-1',
        defaultPolicy: {
          id: 'policy-1',
          targetCodec: 'hevc',
          targetContainer: 'mkv',
          skipReencoding: true,
        },
      });
      mockMediaAnalysis.probeVideoFile.mockResolvedValue({
        codec: 'hevc',
        duration: 3600,
        sizeBytes: 1000000000,
      } as any);
      mockFfmpegService.getVideoInfoCached.mockResolvedValue({
        codec: 'hevc',
        container: 'mp4', // different container
      } as any);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1', hasSharedStorage: false });
      mockJobCrudService.create.mockResolvedValue({ id: 'job-remux' } as any);

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie.mp4',
        fileName: 'movie.mp4',
      });

      expect(mockJobCrudService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'REMUX' })
      );
    });

    it('should create ENCODE job when skipReencoding=false even if codec matches', async () => {
      mockPrisma.library.findUnique.mockResolvedValue({
        id: 'lib-1',
        name: 'Movies',
        nodeId: 'node-1',
        defaultPolicyId: 'policy-1',
        defaultPolicy: {
          id: 'policy-1',
          targetCodec: 'hevc',
          targetContainer: 'mkv',
          skipReencoding: false,
        },
      });
      mockMediaAnalysis.probeVideoFile.mockResolvedValue({
        codec: 'hevc',
        duration: 3600,
        sizeBytes: 1000000000,
      } as any);
      mockFfmpegService.getVideoInfoCached.mockResolvedValue({
        codec: 'hevc',
        container: 'mkv',
      } as any);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1', hasSharedStorage: false });
      mockJobCrudService.create.mockResolvedValue({ id: 'job-reencode' } as any);

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie.mkv',
        fileName: 'movie.mkv',
      });

      expect(mockJobCrudService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ENCODE' })
      );
    });

    it('should throttle AV1 source files to 8 threads', async () => {
      mockPrisma.library.findUnique.mockResolvedValue({
        id: 'lib-1',
        name: 'Movies',
        nodeId: 'node-1',
        defaultPolicyId: 'policy-1',
        defaultPolicy: {
          id: 'policy-1',
          targetCodec: 'hevc',
          targetContainer: 'mkv',
          skipReencoding: false,
        },
      });
      mockMediaAnalysis.probeVideoFile.mockResolvedValue({
        codec: 'av1',
        duration: 7200,
        sizeBytes: 2000000000,
      } as any);
      mockFfmpegService.getVideoInfoCached.mockResolvedValue({
        codec: 'av1',
        container: 'mkv',
      } as any);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1', hasSharedStorage: false });
      mockJobCrudService.create.mockResolvedValue({ id: 'job-av1' } as any);

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie-av1.mkv',
        fileName: 'movie-av1.mkv',
      });

      expect(mockJobCrudService.create).toHaveBeenCalledWith(
        expect.objectContaining({ ffmpegThreads: 8, resourceThrottled: true })
      );
    });

    it('should handle already-exists error gracefully', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      mockPrisma.library.findUnique.mockResolvedValue({
        id: 'lib-1',
        name: 'Movies',
        nodeId: 'node-1',
        defaultPolicyId: 'policy-1',
        defaultPolicy: {
          id: 'policy-1',
          targetCodec: 'hevc',
          targetContainer: 'mkv',
          skipReencoding: false,
        },
      });
      mockMediaAnalysis.probeVideoFile.mockResolvedValue({
        codec: 'h264',
        duration: 3600,
        sizeBytes: 1000000000,
      } as any);
      mockFfmpegService.getVideoInfoCached.mockResolvedValue({
        codec: 'h264',
        container: 'mkv',
      } as any);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1', hasSharedStorage: false });
      mockJobCrudService.create.mockRejectedValue(
        new BadRequestException('Job already exists for this file')
      );

      // Should not throw
      await expect(
        service.handleFileDetected({
          libraryId: 'lib-1',
          filePath: '/media/movie.mkv',
          fileName: 'movie.mkv',
        })
      ).resolves.not.toThrow();
    });

    it('should handle unexpected errors gracefully', async () => {
      mockPrisma.library.findUnique.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.handleFileDetected({
          libraryId: 'lib-1',
          filePath: '/media/movie.mkv',
          fileName: 'movie.mkv',
        })
      ).resolves.not.toThrow();
    });

    it('should trigger file transfer when targetNode differs and has no shared storage', async () => {
      mockPrisma.library.findUnique.mockResolvedValue({
        id: 'lib-1',
        name: 'Movies',
        nodeId: 'node-main',
        defaultPolicyId: 'policy-1',
        defaultPolicy: {
          id: 'policy-1',
          targetCodec: 'hevc',
          targetContainer: 'mkv',
          skipReencoding: false,
        },
      });
      mockMediaAnalysis.probeVideoFile.mockResolvedValue({
        codec: 'h264',
        duration: 3600,
        sizeBytes: 1000000000,
      } as any);
      mockFfmpegService.getVideoInfoCached.mockResolvedValue({
        codec: 'h264',
        container: 'mkv',
      } as any);

      // JobRouter returns a different node
      mockJobRouterService.findBestNodeForJob.mockResolvedValue('node-child');

      // targetNode: no shared storage, different from library node
      mockNodeRepository.findById
        .mockResolvedValueOnce({ id: 'node-child', hasSharedStorage: false }) // targetNode
        .mockResolvedValueOnce({ id: 'node-main', hasSharedStorage: true }); // sourceNode

      mockJobCrudService.create.mockResolvedValue({ id: 'job-transfer' } as any);
      mockFileTransferService.transferFile.mockResolvedValue(undefined);

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie.mkv',
        fileName: 'movie.mkv',
      });

      expect(mockFileTransferService.transferFile).toHaveBeenCalled();
    });
  });

  describe('getNextJob - extended', () => {
    it('should return null when no queued jobs in transaction', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue({
        id: 'node-1',
        hasSharedStorage: true,
        license: { maxConcurrentJobs: 5 },
        _count: { jobs: 1 },
      });
      mockPrisma.$transaction.mockResolvedValue(null);

      const result = await service.getNextJob('node-1');
      expect(result).toBeNull();
    });

    it('should retry up to maxAttempts when claim fails', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue({
        id: 'node-1',
        hasSharedStorage: true,
        license: { maxConcurrentJobs: 5 },
        _count: { jobs: 1 },
      });

      // Always return claimFailed
      mockPrisma.$transaction.mockResolvedValue({ claimFailed: true, attemptedJobId: 'job-x' });

      const result = await service.getNextJob('node-1');
      expect(result).toBeNull();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(5); // maxAttempts
    });

    it('should return claimedJob when transaction succeeds', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findUnique.mockResolvedValue({
        id: 'node-1',
        hasSharedStorage: true,
        license: { maxConcurrentJobs: 5 },
        _count: { jobs: 1 },
      });

      const claimedJob = { id: 'job-claimed', fileLabel: 'movie.mkv' };
      mockPrisma.$transaction.mockResolvedValue({ claimedJob });

      const result = await service.getNextJob('node-1');
      expect(result).toEqual(claimedJob);
    });

    it('should fallback to local DB when linked node proxy fails', async () => {
      const { throwError } = await import('rxjs');
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000/api/v1');
      mockHttpService.get.mockReturnValue(throwError(() => new Error('network error')));

      // After fallback, node not found
      mockNodeRepository.findUnique.mockResolvedValue(null);

      await expect(service.getNextJob('node-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('onModuleInit - policy healing', () => {
    it('should heal codec mismatch for jobs with existing policy', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockPrisma.policy.findMany.mockResolvedValue([
        { id: 'p1', targetCodec: 'hevc', name: 'Default' },
      ]);
      mockJobRepository.updateById.mockResolvedValue({});

      const jobWithMismatch = {
        id: 'job-mismatch',
        policyId: 'p1',
        targetCodec: 'h264', // mismatch
        library: {
          nodeId: 'node-1',
          defaultPolicy: null,
          policies: [],
        },
      };

      // findManyWithInclude returns the job with mismatch
      const _originalFindMany = mockPrisma.job.findMany;
      // We need to use the jobRepository's findManyWithInclude
      const mockJobRepoFull = {
        updateById: mockJobRepository.updateById,
        findManyWithInclude: jest.fn().mockResolvedValue([jobWithMismatch]),
      };

      const { TestingModule: _TestMod } = await import('@nestjs/testing');
      const newModule = await require('@nestjs/testing')
        .Test.createTestingModule({
          providers: [
            (await import('./queue-processing.service')).QueueProcessingService,
            { provide: require('../../prisma/prisma.service').PrismaService, useValue: mockPrisma },
            {
              provide: require('../../common/repositories/job.repository').JobRepository,
              useValue: mockJobRepoFull,
            },
            {
              provide: require('../../common/repositories/node.repository').NodeRepository,
              useValue: mockNodeRepository,
            },
            {
              provide: require('../../libraries/services/media-analysis.service')
                .MediaAnalysisService,
              useValue: mockMediaAnalysis,
            },
            {
              provide: require('../../encoding/ffmpeg.service').FfmpegService,
              useValue: mockFfmpegService,
            },
            {
              provide: require('./job-router.service').JobRouterService,
              useValue: mockJobRouterService,
            },
            {
              provide: require('./file-transfer.service').FileTransferService,
              useValue: mockFileTransferService,
            },
            {
              provide: require('../../core/services/node-config.service').NodeConfigService,
              useValue: mockNodeConfig,
            },
            { provide: require('@nestjs/axios').HttpService, useValue: mockHttpService },
            {
              provide: require('./queue-job-crud.service').QueueJobCrudService,
              useValue: mockJobCrudService,
            },
          ],
        })
        .compile();

      const newService = newModule.get(
        (await import('./queue-processing.service')).QueueProcessingService
      );

      await newService.onModuleInit();

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

      const orphanedJob = {
        id: 'job-orphan',
        policyId: null,
        targetCodec: 'hevc',
        library: {
          nodeId: 'node-1',
          defaultPolicy: { id: 'p1', targetCodec: 'hevc', name: 'Default' },
          policies: [{ id: 'p1', targetCodec: 'hevc', name: 'Default' }],
        },
      };

      const mockJobRepoOrphan = {
        updateById: mockJobRepository.updateById,
        findManyWithInclude: jest.fn().mockResolvedValue([orphanedJob]),
      };

      mockJobRepository.updateById.mockResolvedValue({});

      const newModule2 = await require('@nestjs/testing')
        .Test.createTestingModule({
          providers: [
            (await import('./queue-processing.service')).QueueProcessingService,
            { provide: require('../../prisma/prisma.service').PrismaService, useValue: mockPrisma },
            {
              provide: require('../../common/repositories/job.repository').JobRepository,
              useValue: mockJobRepoOrphan,
            },
            {
              provide: require('../../common/repositories/node.repository').NodeRepository,
              useValue: mockNodeRepository,
            },
            {
              provide: require('../../libraries/services/media-analysis.service')
                .MediaAnalysisService,
              useValue: mockMediaAnalysis,
            },
            {
              provide: require('../../encoding/ffmpeg.service').FfmpegService,
              useValue: mockFfmpegService,
            },
            {
              provide: require('./job-router.service').JobRouterService,
              useValue: mockJobRouterService,
            },
            {
              provide: require('./file-transfer.service').FileTransferService,
              useValue: mockFileTransferService,
            },
            {
              provide: require('../../core/services/node-config.service').NodeConfigService,
              useValue: mockNodeConfig,
            },
            { provide: require('@nestjs/axios').HttpService, useValue: mockHttpService },
            {
              provide: require('./queue-job-crud.service').QueueJobCrudService,
              useValue: mockJobCrudService,
            },
          ],
        })
        .compile();

      const newService2 = newModule2.get(
        (await import('./queue-processing.service')).QueueProcessingService
      );

      await newService2.onModuleInit();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-orphan',
        expect.objectContaining({ policyId: 'p1' })
      );
    });
  });
});
