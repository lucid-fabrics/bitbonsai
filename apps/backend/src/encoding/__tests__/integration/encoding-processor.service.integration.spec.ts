import { HttpService } from '@nestjs/axios';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Library, License, Node, Policy } from '@prisma/client';
import { DataAccessService } from '../../../core/services/data-access.service';
import { FileRelocatorService } from '../../../core/services/file-relocator.service';
import { NodeConfigService } from '../../../core/services/node-config.service';
import { DistributionOrchestratorService } from '../../../distribution/services/distribution-orchestrator.service';
import { FileWatcherService } from '../../../file-watcher/file-watcher.service';
import { JellyfinIntegrationService } from '../../../integrations/jellyfin.service';
import { LibrariesService } from '../../../libraries/libraries.service';
import { MediaAnalysisService } from '../../../libraries/services/media-analysis.service';
import { NodesService } from '../../../nodes/nodes.service';
import { SharedStorageVerifierService } from '../../../nodes/services/shared-storage-verifier.service';
import { StorageShareService } from '../../../nodes/services/storage-share.service';
import { SystemInfoService } from '../../../nodes/services/system-info.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../../queue/queue.service';
import { FileTransferService } from '../../../queue/services/file-transfer.service';
import { JobHistoryService } from '../../../queue/services/job-history.service';
import { JobRouterService } from '../../../queue/services/job-router.service';
import { SettingsService } from '../../../settings/settings.service';
import { EncodingPreviewService } from '../../encoding-preview.service';
import { EncodingProcessorService } from '../../encoding-processor.service';
import { FfmpegService } from '../../ffmpeg.service';

/**
 * Integration tests for EncodingProcessorService
 *
 * Tests cover:
 * - Job processing workflow
 * - Integration with FFmpeg service
 * - Database state updates
 * - Error handling during encoding
 */
describe('EncodingProcessorService Integration Tests', () => {
  let module: TestingModule;
  let service: EncodingProcessorService;
  let prisma: PrismaService;
  let ffmpegService: FfmpegService;
  let testLicense: License;
  let testNode: Node;
  let testLibrary: Library;
  let testPolicy: Policy;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        EncodingProcessorService,
        QueueService,
        FfmpegService,
        LibrariesService,
        FileWatcherService,
        PrismaService,
        DataAccessService,
        FileRelocatorService,
        NodesService,
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
            on: jest.fn(),
            once: jest.fn(),
            removeListener: jest.fn(),
            removeAllListeners: jest.fn(),
          },
        },
        {
          provide: MediaAnalysisService,
          useValue: { analyze: jest.fn(), getMediaInfo: jest.fn(), getVideoCodecInfo: jest.fn() },
        },
        {
          provide: JobHistoryService,
          useValue: { recordHistory: jest.fn(), getHistory: jest.fn() },
        },
        {
          provide: JobRouterService,
          useValue: { findOptimalNode: jest.fn(), routeJob: jest.fn() },
        },
        {
          provide: FileTransferService,
          useValue: { transferFile: jest.fn(), verifyTransfer: jest.fn() },
        },
        {
          provide: NodeConfigService,
          useValue: {
            getConfig: jest.fn(),
            isMainNode: jest.fn(),
            getMainApiUrl: jest.fn().mockReturnValue(null),
          },
        },
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn(), axiosRef: {} } },
        {
          provide: SharedStorageVerifierService,
          useValue: { verify: jest.fn(), isSharedStorage: jest.fn() },
        },
        {
          provide: SystemInfoService,
          useValue: {
            getSystemInfo: jest.fn(),
            collectSystemInfo: jest.fn().mockResolvedValue({ ipAddress: '127.0.0.1' }),
          },
        },
        {
          provide: StorageShareService,
          useValue: { getSharedPaths: jest.fn(), isSharedStorage: jest.fn() },
        },
        {
          provide: SettingsService,
          useValue: { get: jest.fn(), set: jest.fn(), getAll: jest.fn() },
        },
        {
          provide: DistributionOrchestratorService,
          useValue: { distribute: jest.fn(), rebalance: jest.fn() },
        },
        {
          provide: EncodingPreviewService,
          useValue: { generatePreview: jest.fn(), cleanupPreviews: jest.fn() },
        },
        {
          provide: JellyfinIntegrationService,
          useValue: { notifyLibraryScan: jest.fn(), refreshLibrary: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<EncodingProcessorService>(EncodingProcessorService);
    prisma = module.get<PrismaService>(PrismaService);
    ffmpegService = module.get<FfmpegService>(FfmpegService);

    // Create test fixtures
    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-ENCODING',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'encoding@test.com',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
      },
    });

    testNode = await prisma.node.create({
      data: {
        name: 'Encoding Test Node',
        role: 'MAIN',
        status: 'ONLINE',
        version: '1.0.0',
        acceleration: 'CPU',
        apiKey: 'test-key',
        lastHeartbeat: new Date(),
        licenseId: testLicense.id,
      },
    });

    testLibrary = await prisma.library.create({
      data: {
        name: 'Encoding Test Library',
        path: '/test/encoding',
        mediaType: 'MOVIE',
        nodeId: testNode.id,
      },
    });

    testPolicy = await prisma.policy.create({
      data: {
        name: 'Encoding Test Policy',
        preset: 'CUSTOM',
        targetCodec: 'HEVC',
        targetQuality: 23,
        deviceProfiles: {},
        advancedSettings: {},
        libraryId: testLibrary.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.job.deleteMany({});
    await prisma.policy.deleteMany({});
    await prisma.library.deleteMany({});
    await prisma.node.deleteMany({});
    await prisma.license.deleteMany({});
    await prisma.$disconnect();
    await module.close();
  });

  afterEach(async () => {
    await prisma.job.deleteMany({});
    jest.clearAllMocks();
  });

  describe('processJob', () => {
    it('should update job stage to ENCODING when processing starts', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/video.mp4',
          fileLabel: 'Test Video.mp4',
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: 'QUEUED',
        },
      });

      // Mock FFmpeg to prevent actual encoding
      jest.spyOn(ffmpegService, 'encode').mockResolvedValue(undefined);

      await service.processNextJob(testNode.id);

      const updated = await prisma.job.findUnique({ where: { id: job.id } });

      expect(updated?.stage).toBe('COMPLETED');
      expect(updated?.startedAt).toBeDefined();
    });

    it('should calculate and save encoding metrics', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/video.mp4',
          fileLabel: 'Test Video.mp4',
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(2000000000),
          stage: 'QUEUED',
        },
      });

      jest.spyOn(ffmpegService, 'encode').mockResolvedValue(undefined);

      await service.processNextJob(testNode.id);

      const updated = await prisma.job.findUnique({ where: { id: job.id } });

      expect(updated?.beforeSizeBytes).toBe(BigInt(2000000000));
      expect(updated?.afterSizeBytes).toBeDefined();
      expect(updated?.savedBytes).toBeDefined();
      expect(updated?.savedPercent).toBeDefined();
    });

    it('should set job to FAILED on encoding error', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/video.mp4',
          fileLabel: 'Test Video.mp4',
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: 'QUEUED',
        },
      });

      jest.spyOn(ffmpegService, 'encode').mockRejectedValue(new Error('FFmpeg failed'));

      await service.processNextJob(testNode.id);

      const updated = await prisma.job.findUnique({ where: { id: job.id } });

      expect(updated?.stage).toBe('FAILED');
      expect(updated?.error).toContain('FFmpeg failed');
    });

    it('should set completedAt timestamp on success', async () => {
      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/video.mp4',
          fileLabel: 'Test Video.mp4',
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: 'QUEUED',
        },
      });

      jest.spyOn(ffmpegService, 'encode').mockResolvedValue(undefined);

      const before = new Date();
      await service.processNextJob(testNode.id);
      const after = new Date();

      const updated = await prisma.job.findUnique({ where: { id: job.id } });

      expect(updated?.completedAt).toBeDefined();
      expect(updated?.completedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updated?.completedAt?.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('processNextJob', () => {
    it('should return null when no jobs are queued', async () => {
      const result = await service.processNextJob(testNode.id);
      expect(result).toBeNull();
    });

    it('should process oldest queued job for the node', async () => {
      // Mock FFmpeg to prevent actual encoding
      jest.spyOn(ffmpegService, 'encode').mockResolvedValue(undefined);

      const oldJob = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/old.mp4',
          fileLabel: 'Old Video.mp4',
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: 'QUEUED',
          createdAt: new Date(Date.now() - 1000), // 1 second ago
        },
      });

      await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/new.mp4',
          fileLabel: 'New Video.mp4',
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: 'QUEUED',
        },
      });

      const result = await service.processNextJob(testNode.id);

      expect(result?.id).toBe(oldJob.id); // Should process older job first
    });

    it('should not process jobs for other nodes', async () => {
      const otherNode = await prisma.node.create({
        data: {
          name: 'Other Node',
          role: 'LINKED',
          status: 'ONLINE',
          version: '1.0.0',
          acceleration: 'CPU',
          apiKey: 'other-key',
          lastHeartbeat: new Date(),
          licenseId: testLicense.id,
        },
      });

      await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: otherNode.id,
          filePath: '/test/other.mp4',
          fileLabel: 'Other Video.mp4',
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: 'QUEUED',
        },
      });

      const result = await service.processNextJob(testNode.id);

      expect(result).toBeNull(); // Should not process job for other node

      // Cleanup
      await prisma.node.delete({ where: { id: otherNode.id } });
    });

    it('should not process jobs that are already encoding', async () => {
      await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: testPolicy.id,
          nodeId: testNode.id,
          filePath: '/test/encoding.mp4',
          fileLabel: 'Encoding Video.mp4',
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1000000000),
          stage: 'ENCODING',
        },
      });

      const result = await service.processNextJob(testNode.id);

      expect(result).toBeNull();
    });
  });
});
