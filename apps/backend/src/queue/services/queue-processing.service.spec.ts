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
  });
});
