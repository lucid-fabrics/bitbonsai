import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobRepository } from '../../../common/repositories/job.repository';
import { LibraryRepository } from '../../../common/repositories/library.repository';
import { PolicyRepository } from '../../../common/repositories/policy.repository';
import { DistributionOrchestratorService } from '../../../distribution/services/distribution-orchestrator.service';
import { FileHealthStatus, MediaAnalysisService } from '../../../media/media-analysis.service';
import { QueueService } from '../../../queue/queue.service';
import { FileFailureTrackingService } from '../../../queue/services/file-failure-tracking.service';
import { SettingsService } from '../../../settings/settings.service';
import { LibraryBulkJobService } from '../../library-bulk-job.service';
import { LibraryScannerService } from '../../library-scanner.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLibrary(overrides = {}) {
  return {
    id: 'lib-1',
    name: 'Movies',
    path: '/mnt/user/media/Movies',
    nodeId: 'node-1',
    enabled: true,
    defaultPolicyId: 'policy-1',
    defaultPolicy: null,
    ...overrides,
  };
}

function makePolicy(overrides = {}) {
  return {
    id: 'policy-1',
    name: 'HEVC 1080p',
    targetCodec: 'hevc',
    preset: 'medium',
    ...overrides,
  };
}

function makeVideoInfo(overrides = {}) {
  return {
    filePath: '/mnt/user/media/Movies/movie.mkv',
    codec: 'h264',
    resolution: '1920x1080',
    sizeBytes: 1_000_000_000,
    duration: 7200,
    healthStatus: FileHealthStatus.HEALTHY,
    healthMessage: 'OK',
    ...overrides,
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockLibraryRepo = {
  findByWhere: jest.fn(),
  findUniqueWithInclude: jest.fn(),
  findAllLibraries: jest.fn(),
  updateWithInclude: jest.fn(),
};

const mockJobRepo = {
  findManySelect: jest.fn(),
};

const mockPolicyRepo = {
  findById: jest.fn(),
};

const mockMediaAnalysis = {
  analyzeFiles: jest.fn(),
  probeVideoFile: jest.fn(),
};

const mockQueueService = {
  create: jest.fn(),
};

const mockDistributionOrchestrator = {
  findBestNodeForNewJob: jest.fn(),
};

const mockFileFailureTracking = {
  getBlacklistedPaths: jest.fn(),
};

const mockSettingsService = {
  getReadyFilesCacheTtl: jest.fn(),
};

const mockLibraryBulkJobService = {
  createJobsFromScan: jest.fn(),
  createAllJobs: jest.fn(),
  getLibraryFiles: jest.fn(),
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('LibraryScannerService', () => {
  let service: LibraryScannerService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Defaults
    mockDistributionOrchestrator.findBestNodeForNewJob.mockResolvedValue('node-1');
    mockFileFailureTracking.getBlacklistedPaths.mockResolvedValue(new Set());
    mockSettingsService.getReadyFilesCacheTtl.mockResolvedValue({ readyFilesCacheTtlMinutes: 5 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LibraryScannerService,
        { provide: MediaAnalysisService, useValue: mockMediaAnalysis },
        { provide: QueueService, useValue: mockQueueService },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: DistributionOrchestratorService, useValue: mockDistributionOrchestrator },
        { provide: FileFailureTrackingService, useValue: mockFileFailureTracking },
        { provide: LibraryRepository, useValue: mockLibraryRepo },
        { provide: JobRepository, useValue: mockJobRepo },
        { provide: PolicyRepository, useValue: mockPolicyRepo },
        { provide: LibraryBulkJobService, useValue: mockLibraryBulkJobService },
      ],
    }).compile();

    service = module.get(LibraryScannerService);
  });

  // ─── validateLibraryPath ───────────────────────────────────────────────────

  describe('validateLibraryPath', () => {
    it('returns normalized path for valid allowed path', () => {
      expect(service.validateLibraryPath('/mnt/user/media/Movies')).toBe('/mnt/user/media/Movies');
    });

    it('normalizes redundant slashes', () => {
      expect(service.validateLibraryPath('/mnt/user//media/Movies')).toBe('/mnt/user/media/Movies');
    });

    it('accepts /media base path', () => {
      expect(service.validateLibraryPath('/media/videos')).toBe('/media/videos');
    });

    it('accepts /Users base path (macOS)', () => {
      expect(service.validateLibraryPath('/Users/john/Movies')).toBe('/Users/john/Movies');
    });

    it('throws BadRequestException for relative path', () => {
      expect(() => service.validateLibraryPath('relative/path')).toThrow(BadRequestException);
    });

    it('throws BadRequestException for path with traversal sequence', () => {
      // Pass a path that after normalization still contains .. (e.g. on root)
      expect(() => service.validateLibraryPath('/mnt/user/../../etc/passwd')).toThrow(
        BadRequestException
      );
    });

    it('throws BadRequestException for disallowed base directory', () => {
      expect(() => service.validateLibraryPath('/etc/passwd')).toThrow(BadRequestException);
    });

    it('throws BadRequestException for /tmp path', () => {
      expect(() => service.validateLibraryPath('/tmp/videos')).toThrow(BadRequestException);
    });

    it('error message for disallowed path lists allowed directories', () => {
      try {
        service.validateLibraryPath('/var/log');
        fail('should have thrown');
      } catch (err) {
        expect((err as BadRequestException).message).toContain('/mnt/user');
      }
    });
  });

  // ─── invalidateReadyFilesCache ─────────────────────────────────────────────

  describe('invalidateReadyFilesCache', () => {
    it('resets internal cache data and timestamp', () => {
      // Warm the cache artificially
      (service as any).readyFilesCache = { data: [{}], timestamp: 999999 };
      service.invalidateReadyFilesCache();
      expect((service as any).readyFilesCache.data).toBeNull();
      expect((service as any).readyFilesCache.timestamp).toBe(0);
    });
  });

  // ─── getCacheMetadata ──────────────────────────────────────────────────────

  describe('getCacheMetadata', () => {
    it('returns cacheValid=false when cache has never been populated', async () => {
      const result = await service.getCacheMetadata();
      expect(result.cacheValid).toBe(false);
      expect(result.cacheAgeSeconds).toBe(0);
      expect(result.cacheTimestamp).toBeNull();
    });

    it('returns cacheValid=true when cache is fresh', async () => {
      (service as any).readyFilesCache = { data: [], timestamp: Date.now() - 1000 };
      const result = await service.getCacheMetadata();
      expect(result.cacheValid).toBe(true);
      expect(result.cacheAgeSeconds).toBeGreaterThanOrEqual(1);
    });

    it('returns cacheValid=false when cache is expired', async () => {
      // TTL is 5 minutes = 300s; put timestamp 10 minutes ago
      (service as any).readyFilesCache = {
        data: [],
        timestamp: Date.now() - 10 * 60 * 1000,
      };
      const result = await service.getCacheMetadata();
      expect(result.cacheValid).toBe(false);
    });

    it('returns cacheTtlMinutes from settings', async () => {
      mockSettingsService.getReadyFilesCacheTtl.mockResolvedValue({
        readyFilesCacheTtlMinutes: 10,
      });
      const result = await service.getCacheMetadata();
      expect(result.cacheTtlMinutes).toBe(10);
    });
  });

  // ─── scan ──────────────────────────────────────────────────────────────────

  describe('scan', () => {
    it('throws NotFoundException when library does not exist', async () => {
      mockLibraryRepo.findByWhere.mockResolvedValue(null);
      await expect(service.scan('lib-99')).rejects.toThrow(NotFoundException);
    });

    it('scans directory and updates library with file count and size', async () => {
      const library = makeLibrary();
      mockLibraryRepo.findByWhere.mockResolvedValue(library);
      mockLibraryRepo.updateWithInclude.mockResolvedValue({ ...library, totalFiles: 2 });

      // Stub scanDirectoryStream to yield two files
      jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
        yield '/mnt/user/media/Movies/a.mkv';
        yield '/mnt/user/media/Movies/b.mkv';
      });

      // Stub fs.promises.stat
      jest.mock('node:fs', () => ({
        promises: { stat: jest.fn().mockResolvedValue({ size: 500_000_000 }) },
      }));

      const result = await service.scan('lib-1');

      expect(mockLibraryRepo.updateWithInclude).toHaveBeenCalledWith(
        { id: 'lib-1' },
        expect.objectContaining({ totalFiles: expect.any(Number), lastScanAt: expect.any(Date) }),
        expect.any(Object)
      );
      expect(result).not.toBeNull();
    });

    it('throws when updateWithInclude throws', async () => {
      mockLibraryRepo.findByWhere.mockResolvedValue(makeLibrary());
      jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
        /* empty */
      });
      mockLibraryRepo.updateWithInclude.mockRejectedValue(new Error('DB error'));

      await expect(service.scan('lib-1')).rejects.toThrow('DB error');
    });
  });

  // ─── scanPreview ───────────────────────────────────────────────────────────

  describe('scanPreview', () => {
    it('throws NotFoundException when library does not exist', async () => {
      mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(null);
      await expect(service.scanPreview('lib-99')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when library has no default policy', async () => {
      mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary({ defaultPolicy: null }));
      await expect(service.scanPreview('lib-1')).rejects.toThrow(BadRequestException);
    });

    it('returns preview DTO with annotated files', async () => {
      const policy = makePolicy();
      const library = makeLibrary({ defaultPolicy: policy });
      mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(library);

      jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
        yield '/mnt/user/media/Movies/movie.mkv';
      });

      mockMediaAnalysis.analyzeFiles.mockResolvedValue({
        needsEncoding: [makeVideoInfo()],
        alreadyOptimized: [],
        totalFiles: 1,
        totalSizeBytes: BigInt(1_000_000_000),
        errors: [],
      });

      mockJobRepo.findManySelect.mockResolvedValue([]);

      const result = await service.scanPreview('lib-1');

      expect(result.libraryId).toBe('lib-1');
      expect(result.needsEncoding).toHaveLength(1);
      expect(result.needsEncoding[0].canAddToQueue).toBe(true);
    });

    it('marks file as not addable when job stage is QUEUED', async () => {
      const policy = makePolicy();
      const library = makeLibrary({ defaultPolicy: policy });
      mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(library);

      const filePath = '/mnt/user/media/Movies/movie.mkv';

      jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
        yield filePath;
      });

      mockMediaAnalysis.analyzeFiles.mockResolvedValue({
        needsEncoding: [makeVideoInfo({ filePath })],
        alreadyOptimized: [],
        totalFiles: 1,
        totalSizeBytes: BigInt(1_000_000_000),
        errors: [],
      });

      mockJobRepo.findManySelect.mockResolvedValue([
        { id: 'job-1', filePath, stage: 'QUEUED', progress: 50, isBlacklisted: false },
      ]);

      const result = await service.scanPreview('lib-1');
      expect(result.needsEncoding[0].canAddToQueue).toBe(false);
      expect(result.needsEncoding[0].blockedReason).toBe('Queued for encoding');
    });

    it('marks file as addable when job stage is FAILED', async () => {
      const policy = makePolicy();
      const library = makeLibrary({ defaultPolicy: policy });
      mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(library);

      const filePath = '/mnt/user/media/Movies/movie.mkv';

      jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
        yield filePath;
      });

      mockMediaAnalysis.analyzeFiles.mockResolvedValue({
        needsEncoding: [makeVideoInfo({ filePath })],
        alreadyOptimized: [],
        totalFiles: 1,
        totalSizeBytes: BigInt(1_000_000_000),
        errors: [],
      });

      mockJobRepo.findManySelect.mockResolvedValue([
        { id: 'job-1', filePath, stage: 'FAILED', progress: null, isBlacklisted: false },
      ]);

      const result = await service.scanPreview('lib-1');
      expect(result.needsEncoding[0].canAddToQueue).toBe(true);
    });

    it('excludes blacklisted files from preview', async () => {
      const policy = makePolicy();
      const library = makeLibrary({ defaultPolicy: policy });
      mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(library);

      const filePath = '/mnt/user/media/Movies/movie.mkv';

      jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
        yield filePath;
      });

      mockMediaAnalysis.analyzeFiles.mockResolvedValue({
        needsEncoding: [makeVideoInfo({ filePath })],
        alreadyOptimized: [],
        totalFiles: 1,
        totalSizeBytes: BigInt(1_000_000_000),
        errors: [],
      });

      // File is blacklisted
      mockJobRepo.findManySelect.mockResolvedValue([
        { id: 'job-1', filePath, stage: 'FAILED', progress: null, isBlacklisted: true },
      ]);

      const result = await service.scanPreview('lib-1');
      expect(result.needsEncoding).toHaveLength(0);
    });
  });

  // ─── createJobsFromScan ────────────────────────────────────────────────────

  describe('createJobsFromScan', () => {
    it('delegates to LibraryBulkJobService and returns result', async () => {
      const expected = { jobsCreated: 2, jobs: [{} as any, {} as any] };
      mockLibraryBulkJobService.createJobsFromScan.mockResolvedValue(expected);

      const result = await service.createJobsFromScan('lib-1', 'policy-1', ['/a.mkv']);
      expect(mockLibraryBulkJobService.createJobsFromScan).toHaveBeenCalledWith(
        'lib-1',
        'policy-1',
        ['/a.mkv']
      );
      expect(result).toEqual(expected);
    });

    it('invalidates cache when jobs are created', async () => {
      mockLibraryBulkJobService.createJobsFromScan.mockResolvedValue({
        jobsCreated: 1,
        jobs: [{} as any],
      });
      const invalidateSpy = jest.spyOn(service, 'invalidateReadyFilesCache');

      await service.createJobsFromScan('lib-1', 'policy-1', ['/a.mkv']);
      expect(invalidateSpy).toHaveBeenCalled();
    });

    it('does not invalidate cache when no jobs created', async () => {
      mockLibraryBulkJobService.createJobsFromScan.mockResolvedValue({
        jobsCreated: 0,
        jobs: [],
      });
      const invalidateSpy = jest.spyOn(service, 'invalidateReadyFilesCache');

      await service.createJobsFromScan('lib-1', 'policy-1', []);
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('propagates errors from LibraryBulkJobService', async () => {
      mockLibraryBulkJobService.createJobsFromScan.mockRejectedValue(
        new NotFoundException('Library not found')
      );
      await expect(service.createJobsFromScan('lib-99')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── createAllJobs ─────────────────────────────────────────────────────────

  describe('createAllJobs', () => {
    it('delegates to LibraryBulkJobService and returns result', async () => {
      const expected = { jobsCreated: 3, filesSkipped: 1, skippedFiles: [] };
      mockLibraryBulkJobService.createAllJobs.mockResolvedValue(expected);

      const result = await service.createAllJobs('lib-1', 'policy-1');
      expect(mockLibraryBulkJobService.createAllJobs).toHaveBeenCalledWith('lib-1', 'policy-1');
      expect(result).toEqual(expected);
    });

    it('propagates errors from LibraryBulkJobService', async () => {
      mockLibraryBulkJobService.createAllJobs.mockRejectedValue(
        new NotFoundException('Library not found')
      );
      await expect(service.createAllJobs('lib-99', 'policy-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getAllReadyFiles ──────────────────────────────────────────────────────

  describe('getAllReadyFiles', () => {
    it('returns empty array when no libraries with policies exist', async () => {
      mockLibraryRepo.findAllLibraries.mockResolvedValue([]);
      const result = await service.getAllReadyFiles();
      expect(result).toEqual([]);
    });

    it('returns cached result when cache is still valid', async () => {
      const cachedData = [{ libraryId: 'lib-1' }] as any;
      (service as any).readyFilesCache = {
        data: cachedData,
        timestamp: Date.now() - 1000, // 1 second old, well within 5 min TTL
      };
      const result = await service.getAllReadyFiles();
      expect(result).toBe(cachedData);
      expect(mockLibraryRepo.findAllLibraries).not.toHaveBeenCalled();
    });

    it('fetches fresh data when cache is expired', async () => {
      // Expired cache
      (service as any).readyFilesCache = {
        data: [],
        timestamp: Date.now() - 10 * 60 * 1000,
      };
      mockLibraryRepo.findAllLibraries.mockResolvedValue([]);

      await service.getAllReadyFiles();
      expect(mockLibraryRepo.findAllLibraries).toHaveBeenCalled();
    });

    it('filters libraries without defaultPolicy', async () => {
      mockLibraryRepo.findAllLibraries.mockResolvedValue([
        makeLibrary({ defaultPolicy: null }),
        makeLibrary({ id: 'lib-2', defaultPolicy: makePolicy() }),
      ]);

      const scanPreviewSpy = jest.spyOn(service, 'scanPreview').mockResolvedValue({
        libraryId: 'lib-2',
        libraryName: 'Movies',
        policyId: 'policy-1',
        policyName: 'HEVC',
        targetCodec: 'hevc',
        availablePolicies: [],
        totalFiles: 1,
        totalSizeBytes: '1000',
        needsEncodingCount: 1,
        alreadyOptimizedCount: 0,
        needsEncoding: [],
        alreadyOptimized: [],
        errors: [],
        scannedAt: new Date(),
      });

      const result = await service.getAllReadyFiles();
      expect(scanPreviewSpy).toHaveBeenCalledTimes(1);
      expect(scanPreviewSpy).toHaveBeenCalledWith('lib-2');
      expect(result).toHaveLength(1);
      scanPreviewSpy.mockRestore();
    });

    it('handles partial scanPreview failures gracefully', async () => {
      mockLibraryRepo.findAllLibraries.mockResolvedValue([
        makeLibrary({ defaultPolicy: makePolicy() }),
        makeLibrary({ id: 'lib-2', defaultPolicy: makePolicy() }),
      ]);

      jest
        .spyOn(service, 'scanPreview')
        .mockResolvedValueOnce({
          libraryId: 'lib-1',
          libraryName: 'Movies',
          policyId: 'policy-1',
          policyName: 'HEVC',
          targetCodec: 'hevc',
          availablePolicies: [],
          totalFiles: 1,
          totalSizeBytes: '1000',
          needsEncodingCount: 1,
          alreadyOptimizedCount: 0,
          needsEncoding: [],
          alreadyOptimized: [],
          errors: [],
          scannedAt: new Date(),
        })
        .mockRejectedValueOnce(new Error('scan failed'));

      const result = await service.getAllReadyFiles();
      expect(result).toHaveLength(1);
    });

    it('caches the result for subsequent calls', async () => {
      mockLibraryRepo.findAllLibraries.mockResolvedValue([]);

      await service.getAllReadyFiles();
      await service.getAllReadyFiles();

      // findAllLibraries should only be called once (second call hits cache)
      expect(mockLibraryRepo.findAllLibraries).toHaveBeenCalledTimes(1);
    });
  });

  // ─── getLibraryFiles ───────────────────────────────────────────────────────

  describe('getLibraryFiles', () => {
    it('delegates to LibraryBulkJobService and returns result', async () => {
      const expected = {
        libraryId: 'lib-1',
        libraryName: 'Movies',
        totalFiles: 1,
        totalSizeBytes: '1000000',
        files: [{ fileName: 'movie.mkv' }],
        scannedAt: new Date(),
      } as any;
      mockLibraryBulkJobService.getLibraryFiles.mockResolvedValue(expected);

      const result = await service.getLibraryFiles('lib-1');
      expect(mockLibraryBulkJobService.getLibraryFiles).toHaveBeenCalledWith('lib-1');
      expect(result).toEqual(expected);
    });

    it('propagates errors from LibraryBulkJobService', async () => {
      mockLibraryBulkJobService.getLibraryFiles.mockRejectedValue(
        new NotFoundException('Library not found')
      );
      await expect(service.getLibraryFiles('lib-99')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── autoRefreshReadyFilesCache ────────────────────────────────────────────

  describe('autoRefreshReadyFilesCache', () => {
    it('does not throw when getAllReadyFiles succeeds', async () => {
      jest.spyOn(service, 'getAllReadyFiles').mockResolvedValue([]);
      await expect(service.autoRefreshReadyFilesCache()).resolves.toBeUndefined();
    });

    it('does not throw when getAllReadyFiles fails', async () => {
      jest.spyOn(service, 'getAllReadyFiles').mockRejectedValue(new Error('scan error'));
      await expect(service.autoRefreshReadyFilesCache()).resolves.toBeUndefined();
    });
  });
});
