import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NodeRepository } from '../../common/repositories/node.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { MediaAnalysisService } from '../../media/media-analysis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FileTransferService } from './file-transfer.service';
import { JobRouterService } from './job-router.service';
import { QueueFileDetectionService } from './queue-file-detection.service';
import { QueueJobCrudService } from './queue-job-crud.service';

describe('QueueFileDetectionService', () => {
  let service: QueueFileDetectionService;
  let mockPrisma: any;
  let mockMediaAnalysis: jest.Mocked<MediaAnalysisService>;
  let mockFfmpegService: jest.Mocked<FfmpegService>;
  let mockJobRouterService: jest.Mocked<JobRouterService>;
  let mockFileTransferService: jest.Mocked<FileTransferService>;
  let mockNodeConfig: jest.Mocked<NodeConfigService>;
  let mockJobCrudService: jest.Mocked<QueueJobCrudService>;
  let mockNodeRepository: { findById: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      library: { findUnique: jest.fn() },
    };

    mockMediaAnalysis = { probeVideoFile: jest.fn() } as any;
    mockFfmpegService = { getVideoInfoCached: jest.fn() } as any;
    mockJobRouterService = { findBestNodeForJob: jest.fn().mockResolvedValue(null) } as any;
    mockFileTransferService = { transferFile: jest.fn() } as any;
    mockNodeConfig = {
      getMainApiUrl: jest.fn().mockReturnValue(null),
      getNodeId: jest.fn().mockReturnValue(null),
    } as any;
    mockJobCrudService = { create: jest.fn() } as any;
    mockNodeRepository = { findById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueFileDetectionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NodeRepository, useValue: mockNodeRepository },
        { provide: MediaAnalysisService, useValue: mockMediaAnalysis },
        { provide: FfmpegService, useValue: mockFfmpegService },
        { provide: JobRouterService, useValue: mockJobRouterService },
        { provide: FileTransferService, useValue: mockFileTransferService },
        { provide: NodeConfigService, useValue: mockNodeConfig },
        { provide: QueueJobCrudService, useValue: mockJobCrudService },
      ],
    }).compile();

    service = module.get<QueueFileDetectionService>(QueueFileDetectionService);
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
        container: 'mkv',
      } as any);

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie.mkv',
        fileName: 'movie.mkv',
      });

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
        container: 'mp4',
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
      mockJobRouterService.findBestNodeForJob.mockResolvedValue('node-child');
      mockNodeRepository.findById
        .mockResolvedValueOnce({ id: 'node-child', hasSharedStorage: false })
        .mockResolvedValueOnce({ id: 'node-main', hasSharedStorage: true });
      mockJobCrudService.create.mockResolvedValue({ id: 'job-transfer' } as any);
      mockFileTransferService.transferFile.mockResolvedValue(undefined);

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie.mkv',
        fileName: 'movie.mkv',
      });

      expect(mockFileTransferService.transferFile).toHaveBeenCalled();
    });

    it('should not throw when background file transfer fails', async () => {
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
      mockJobRouterService.findBestNodeForJob.mockResolvedValue('node-child');
      mockNodeRepository.findById
        .mockResolvedValueOnce({ id: 'node-child', hasSharedStorage: false })
        .mockResolvedValueOnce({ id: 'node-main', hasSharedStorage: true });
      mockJobCrudService.create.mockResolvedValue({ id: 'job-transfer-fail' } as any);
      mockFileTransferService.transferFile.mockRejectedValue(new Error('transfer failed'));

      await expect(
        service.handleFileDetected({
          libraryId: 'lib-1',
          filePath: '/media/movie.mkv',
          fileName: 'movie.mkv',
        })
      ).resolves.not.toThrow();
    });

    it('should use library nodeId as fallback when jobRouter returns null', async () => {
      mockPrisma.library.findUnique.mockResolvedValue({
        id: 'lib-1',
        name: 'Movies',
        nodeId: 'node-fallback',
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
        duration: 1800,
        sizeBytes: 500000000,
      } as any);
      mockFfmpegService.getVideoInfoCached.mockResolvedValue({
        codec: 'h264',
        container: 'mkv',
      } as any);
      mockJobRouterService.findBestNodeForJob.mockResolvedValue(null);
      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-fallback',
        hasSharedStorage: true,
      });
      mockJobCrudService.create.mockResolvedValue({ id: 'job-fallback' } as any);

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie.mkv',
        fileName: 'movie.mkv',
      });

      expect(mockJobCrudService.create).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'node-fallback' })
      );
    });

    it('should use mkv as default targetContainer when policy has none', async () => {
      mockPrisma.library.findUnique.mockResolvedValue({
        id: 'lib-1',
        name: 'Movies',
        nodeId: 'node-1',
        defaultPolicyId: 'policy-1',
        defaultPolicy: {
          id: 'policy-1',
          targetCodec: 'hevc',
          targetContainer: null,
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
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1', hasSharedStorage: true });
      mockJobCrudService.create.mockResolvedValue({ id: 'job-default-container' } as any);

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie.mkv',
        fileName: 'movie.mkv',
      });

      expect(mockJobCrudService.create).toHaveBeenCalledWith(
        expect.objectContaining({ targetContainer: 'mkv' })
      );
    });

    it('should create ENCODE job when codecs differ', async () => {
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
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1', hasSharedStorage: true });
      mockJobCrudService.create.mockResolvedValue({ id: 'job-encode' } as any);

      await service.handleFileDetected({
        libraryId: 'lib-1',
        filePath: '/media/movie.mkv',
        fileName: 'movie.mkv',
      });

      expect(mockJobCrudService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ENCODE' })
      );
    });
  });
});
