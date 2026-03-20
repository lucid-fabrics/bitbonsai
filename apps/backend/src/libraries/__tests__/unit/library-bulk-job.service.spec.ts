import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../../common/repositories/job.repository';
import { LibraryRepository } from '../../../common/repositories/library.repository';
import { PolicyRepository } from '../../../common/repositories/policy.repository';
import { DistributionOrchestratorService } from '../../../distribution/services/distribution-orchestrator.service';
import { FileHealthStatus, MediaAnalysisService } from '../../../media/media-analysis.service';
import { QueueService } from '../../../queue/queue.service';
import { FileFailureTrackingService } from '../../../queue/services/file-failure-tracking.service';
import { LibraryBulkJobService } from '../../library-bulk-job.service';

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
    node: null,
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

function makeJob(overrides = {}) {
  return {
    id: 'job-1',
    filePath: '/mnt/user/media/Movies/movie.mkv',
    fileLabel: 'movie.mkv',
    sourceCodec: 'h264',
    targetCodec: 'hevc',
    beforeSizeBytes: '1000000000',
    nodeId: 'node-1',
    libraryId: 'lib-1',
    policyId: 'policy-1',
    stage: JobStage.QUEUED,
    isBlacklisted: false,
    progress: 0,
    ...overrides,
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockLibraryRepo = {
  findByWhere: jest.fn(),
  findUniqueWithInclude: jest.fn(),
};

const mockPolicyRepo = {
  findById: jest.fn(),
};

const mockJobRepo = {
  findManySelect: jest.fn(),
};

const mockMediaAnalysis = {
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

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('LibraryBulkJobService', () => {
  let service: LibraryBulkJobService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LibraryBulkJobService,
        { provide: LibraryRepository, useValue: mockLibraryRepo },
        { provide: PolicyRepository, useValue: mockPolicyRepo },
        { provide: JobRepository, useValue: mockJobRepo },
        { provide: MediaAnalysisService, useValue: mockMediaAnalysis },
        { provide: QueueService, useValue: mockQueueService },
        { provide: DistributionOrchestratorService, useValue: mockDistributionOrchestrator },
        { provide: FileFailureTrackingService, useValue: mockFileFailureTracking },
      ],
    }).compile();

    service = module.get(LibraryBulkJobService);

    // Default: no directory to scan (scanDirectoryStream yields nothing)
    jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
      /* empty */
    });

    // Default happy-path stubs
    mockDistributionOrchestrator.findBestNodeForNewJob.mockResolvedValue('node-1');
    mockFileFailureTracking.getBlacklistedPaths.mockResolvedValue(new Set<string>());
    mockJobRepo.findManySelect.mockResolvedValue([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // createJobsFromScan
  // ───────────────────────────────────────────────────────────────────────────

  describe('createJobsFromScan', () => {
    describe('happy path — with explicit filePaths', () => {
      it('returns jobsCreated count and jobs array', async () => {
        const library = makeLibrary();
        const policy = makePolicy();
        const job = makeJob();
        const filePath = '/mnt/user/media/Movies/movie.mkv';

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(library);
        mockPolicyRepo.findById.mockResolvedValue(policy);
        mockMediaAnalysis.probeVideoFile.mockResolvedValue(makeVideoInfo({ filePath }));
        mockQueueService.create.mockResolvedValue(job);

        const result = await service.createJobsFromScan('lib-1', 'policy-1', [filePath]);

        expect(result.jobsCreated).toBe(1);
        expect(result.jobs).toHaveLength(1);
        expect(result.jobs[0].id).toBe('job-1');
      });

      it('calls queueService.create with correct payload', async () => {
        const library = makeLibrary();
        const policy = makePolicy();
        const filePath = '/mnt/user/media/Movies/movie.mkv';
        const videoInfo = makeVideoInfo({ filePath });

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(library);
        mockPolicyRepo.findById.mockResolvedValue(policy);
        mockMediaAnalysis.probeVideoFile.mockResolvedValue(videoInfo);
        mockQueueService.create.mockResolvedValue(makeJob());

        await service.createJobsFromScan('lib-1', 'policy-1', [filePath]);

        expect(mockQueueService.create).toHaveBeenCalledWith({
          filePath,
          fileLabel: 'movie.mkv',
          sourceCodec: videoInfo.codec,
          targetCodec: policy.targetCodec,
          beforeSizeBytes: videoInfo.sizeBytes.toString(),
          nodeId: 'node-1',
          libraryId: library.id,
          policyId: policy.id,
        });
      });
    });

    describe('happy path — no filePaths (re-scan)', () => {
      it('scans directory and creates jobs for discovered files', async () => {
        const library = makeLibrary();
        const policy = makePolicy();
        const filePath = '/mnt/user/media/Movies/found.mkv';
        const job = makeJob({ filePath });

        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield filePath;
        });

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(library);
        mockPolicyRepo.findById.mockResolvedValue(policy);
        mockMediaAnalysis.probeVideoFile.mockResolvedValue(makeVideoInfo({ filePath }));
        mockQueueService.create.mockResolvedValue(job);

        const result = await service.createJobsFromScan('lib-1', 'policy-1');

        expect(result.jobsCreated).toBe(1);
        expect(result.jobs[0].filePath).toBe(filePath);
      });

      it('returns zero when directory is empty', async () => {
        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(makePolicy());

        const result = await service.createJobsFromScan('lib-1', 'policy-1');

        expect(result.jobsCreated).toBe(0);
        expect(result.jobs).toEqual([]);
      });
    });

    describe('happy path — falls back to library defaultPolicyId', () => {
      it('uses defaultPolicyId when no policyId argument is given', async () => {
        const library = makeLibrary({ defaultPolicyId: 'default-policy' });
        const policy = makePolicy({ id: 'default-policy' });

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(library);
        mockPolicyRepo.findById.mockResolvedValue(policy);

        const result = await service.createJobsFromScan('lib-1');

        expect(mockPolicyRepo.findById).toHaveBeenCalledWith('default-policy');
        expect(result.jobsCreated).toBe(0);
      });
    });

    describe('NotFoundException', () => {
      it('throws when library is not found', async () => {
        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(null);

        await expect(service.createJobsFromScan('missing-lib', 'policy-1')).rejects.toThrow(
          new NotFoundException('Library with ID "missing-lib" not found')
        );
      });

      it('throws when policy is not found', async () => {
        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(null);

        await expect(service.createJobsFromScan('lib-1', 'bad-policy')).rejects.toThrow(
          new NotFoundException('Policy with ID "bad-policy" not found')
        );
      });
    });

    describe('BadRequestException', () => {
      it('throws when no policyId provided and library has no default policy', async () => {
        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(
          makeLibrary({ defaultPolicyId: null })
        );

        await expect(service.createJobsFromScan('lib-1')).rejects.toThrow(BadRequestException);
      });
    });

    describe('skipping blacklisted files', () => {
      it('skips files that are manually blacklisted', async () => {
        const blacklistedPath = '/mnt/user/media/Movies/bad.mkv';
        const goodPath = '/mnt/user/media/Movies/good.mkv';

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(makePolicy());
        mockJobRepo.findManySelect.mockResolvedValue([{ filePath: blacklistedPath }]);
        mockMediaAnalysis.probeVideoFile.mockResolvedValue(makeVideoInfo({ filePath: goodPath }));
        mockQueueService.create.mockResolvedValue(makeJob({ filePath: goodPath }));

        const result = await service.createJobsFromScan('lib-1', 'policy-1', [
          blacklistedPath,
          goodPath,
        ]);

        expect(result.jobsCreated).toBe(1);
        expect(result.jobs[0].filePath).toBe(goodPath);
        expect(mockQueueService.create).not.toHaveBeenCalledWith(
          expect.objectContaining({ filePath: blacklistedPath })
        );
      });

      it('skips auto-blacklisted files from failure tracking', async () => {
        const autoBlacklisted = '/mnt/user/media/Movies/auto-bad.mkv';

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(makePolicy());
        mockFileFailureTracking.getBlacklistedPaths.mockResolvedValue(new Set([autoBlacklisted]));

        const result = await service.createJobsFromScan('lib-1', 'policy-1', [autoBlacklisted]);

        expect(result.jobsCreated).toBe(0);
        expect(result.jobs).toEqual([]);
        expect(mockQueueService.create).not.toHaveBeenCalled();
      });
    });

    describe('skipping files that fail to probe', () => {
      it('does not create a job when probeVideoFile returns null', async () => {
        const filePath = '/mnt/user/media/Movies/unreadable.mkv';

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(makePolicy());
        mockMediaAnalysis.probeVideoFile.mockResolvedValue(null);

        const result = await service.createJobsFromScan('lib-1', 'policy-1', [filePath]);

        expect(result.jobsCreated).toBe(0);
        expect(mockQueueService.create).not.toHaveBeenCalled();
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // createAllJobs
  // ───────────────────────────────────────────────────────────────────────────

  describe('createAllJobs', () => {
    describe('happy path', () => {
      it('returns correct BulkJobCreationResultDto shape', async () => {
        const filePath = '/mnt/user/media/Movies/movie.mkv';

        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield filePath;
        });

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(makePolicy());
        mockMediaAnalysis.probeVideoFile.mockResolvedValue(makeVideoInfo({ filePath }));
        mockQueueService.create.mockResolvedValue(makeJob({ filePath }));

        const result = await service.createAllJobs('lib-1', 'policy-1');

        expect(result.jobsCreated).toBe(1);
        expect(result.filesSkipped).toBe(0);
        expect(result.skippedFiles).toEqual([]);
      });

      it('returns zero jobs when directory is empty', async () => {
        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(makePolicy());

        const result = await service.createAllJobs('lib-1', 'policy-1');

        expect(result.jobsCreated).toBe(0);
        expect(result.filesSkipped).toBe(0);
      });
    });

    describe('NotFoundException', () => {
      it('throws when library is not found', async () => {
        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(null);

        await expect(service.createAllJobs('missing-lib', 'policy-1')).rejects.toThrow(
          new NotFoundException('Library with ID "missing-lib" not found')
        );
      });

      it('throws when policy is not found', async () => {
        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(null);

        await expect(service.createAllJobs('lib-1', 'bad-policy')).rejects.toThrow(
          new NotFoundException('Policy with ID "bad-policy" not found')
        );
      });
    });

    describe('skipping already-queued files', () => {
      it('skips files already present in the job queue', async () => {
        const queuedPath = '/mnt/user/media/Movies/queued.mkv';

        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield queuedPath;
        });

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(makePolicy());
        mockJobRepo.findManySelect.mockResolvedValue([
          { filePath: queuedPath, isBlacklisted: false },
        ]);

        const result = await service.createAllJobs('lib-1', 'policy-1');

        expect(result.jobsCreated).toBe(0);
        expect(result.filesSkipped).toBe(1);
        expect(result.skippedFiles).toEqual([{ path: queuedPath, reason: 'Already in queue' }]);
        expect(mockQueueService.create).not.toHaveBeenCalled();
      });
    });

    describe('skipping blacklisted files', () => {
      it('skips manually blacklisted files with reason "Blacklisted"', async () => {
        const blacklistedPath = '/mnt/user/media/Movies/bad.mkv';

        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield blacklistedPath;
        });

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(makePolicy());
        mockJobRepo.findManySelect.mockResolvedValue([
          { filePath: blacklistedPath, isBlacklisted: true },
        ]);

        const result = await service.createAllJobs('lib-1', 'policy-1');

        expect(result.jobsCreated).toBe(0);
        expect(result.filesSkipped).toBe(1);
        expect(result.skippedFiles).toEqual([{ path: blacklistedPath, reason: 'Blacklisted' }]);
      });

      it('skips auto-blacklisted files from failure tracking', async () => {
        const autoBlacklisted = '/mnt/user/media/Movies/auto-bad.mkv';

        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield autoBlacklisted;
        });

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(makePolicy());
        mockFileFailureTracking.getBlacklistedPaths.mockResolvedValue(new Set([autoBlacklisted]));

        const result = await service.createAllJobs('lib-1', 'policy-1');

        expect(result.jobsCreated).toBe(0);
        expect(result.filesSkipped).toBe(1);
        expect(result.skippedFiles).toEqual([
          { path: autoBlacklisted, reason: 'Auto-blacklisted (repeated failures)' },
        ]);
      });
    });

    describe('skipping files that fail to probe', () => {
      it('records skipped file with reason "Failed to probe file"', async () => {
        const filePath = '/mnt/user/media/Movies/unreadable.mkv';

        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield filePath;
        });

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(makePolicy());
        mockMediaAnalysis.probeVideoFile.mockResolvedValue(null);

        const result = await service.createAllJobs('lib-1', 'policy-1');

        expect(result.jobsCreated).toBe(0);
        expect(result.filesSkipped).toBe(1);
        expect(result.skippedFiles).toEqual([{ path: filePath, reason: 'Failed to probe file' }]);
      });
    });

    describe('mixed batch', () => {
      it('correctly tallies created and skipped across multiple files', async () => {
        const goodPath = '/mnt/user/media/Movies/good.mkv';
        const queuedPath = '/mnt/user/media/Movies/queued.mkv';
        const badProbePath = '/mnt/user/media/Movies/unreadable.mkv';

        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield goodPath;
          yield queuedPath;
          yield badProbePath;
        });

        mockLibraryRepo.findUniqueWithInclude.mockResolvedValue(makeLibrary());
        mockPolicyRepo.findById.mockResolvedValue(makePolicy());
        mockJobRepo.findManySelect.mockResolvedValue([
          { filePath: queuedPath, isBlacklisted: false },
        ]);
        mockMediaAnalysis.probeVideoFile.mockImplementation((fp: string) =>
          fp === goodPath
            ? Promise.resolve(makeVideoInfo({ filePath: goodPath }))
            : Promise.resolve(null)
        );
        mockQueueService.create.mockResolvedValue(makeJob({ filePath: goodPath }));

        const result = await service.createAllJobs('lib-1', 'policy-1');

        expect(result.jobsCreated).toBe(1);
        expect(result.filesSkipped).toBe(2);
        expect(result.skippedFiles).toHaveLength(2);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // getLibraryFiles
  // ───────────────────────────────────────────────────────────────────────────

  describe('getLibraryFiles', () => {
    describe('happy path', () => {
      it('returns correct LibraryFilesDto shape', async () => {
        const library = makeLibrary();
        const filePath = '/mnt/user/media/Movies/movie.mkv';
        const videoInfo = makeVideoInfo({ filePath });

        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield filePath;
        });

        mockLibraryRepo.findByWhere.mockResolvedValue(library);
        mockMediaAnalysis.probeVideoFile.mockResolvedValue(videoInfo);

        const result = await service.getLibraryFiles('lib-1');

        expect(result.libraryId).toBe('lib-1');
        expect(result.libraryName).toBe('Movies');
        expect(result.totalFiles).toBe(1);
        expect(result.totalSizeBytes).toBe('1000000000');
        expect(result.files).toHaveLength(1);
        expect(result.files[0].filePath).toBe(filePath);
        expect(result.files[0].fileName).toBe('movie.mkv');
        expect(result.files[0].codec).toBe('h264');
        expect(result.scannedAt).toBeInstanceOf(Date);
      });

      it('marks file canAddToQueue=true when health is HEALTHY', async () => {
        const filePath = '/mnt/user/media/Movies/healthy.mkv';

        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield filePath;
        });

        mockLibraryRepo.findByWhere.mockResolvedValue(makeLibrary());
        mockMediaAnalysis.probeVideoFile.mockResolvedValue(
          makeVideoInfo({ filePath, healthStatus: FileHealthStatus.HEALTHY })
        );

        const result = await service.getLibraryFiles('lib-1');

        expect((result.files[0] as unknown as Record<string, unknown>).canAddToQueue).toBe(true);
        expect(
          (result.files[0] as unknown as Record<string, unknown>).blockedReason
        ).toBeUndefined();
      });

      it('marks file canAddToQueue=false when health is CORRUPTED', async () => {
        const filePath = '/mnt/user/media/Movies/corrupted.mkv';

        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield filePath;
        });

        mockLibraryRepo.findByWhere.mockResolvedValue(makeLibrary());
        mockMediaAnalysis.probeVideoFile.mockResolvedValue(
          makeVideoInfo({
            filePath,
            healthStatus: FileHealthStatus.CORRUPTED,
            healthMessage: 'File is corrupted',
          })
        );

        const result = await service.getLibraryFiles('lib-1');

        expect((result.files[0] as unknown as Record<string, unknown>).canAddToQueue).toBe(false);
        expect((result.files[0] as unknown as Record<string, unknown>).blockedReason).toBe(
          'File is corrupted'
        );
      });

      it('returns empty files array and zero size when library has no videos', async () => {
        mockLibraryRepo.findByWhere.mockResolvedValue(makeLibrary());

        const result = await service.getLibraryFiles('lib-1');

        expect(result.totalFiles).toBe(0);
        expect(result.totalSizeBytes).toBe('0');
        expect(result.files).toEqual([]);
      });

      it('sorts files alphabetically by fileName', async () => {
        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield '/mnt/user/media/Movies/zebra.mkv';
          yield '/mnt/user/media/Movies/alpha.mkv';
        });

        mockLibraryRepo.findByWhere.mockResolvedValue(makeLibrary());
        mockMediaAnalysis.probeVideoFile.mockImplementation((fp: string) =>
          Promise.resolve(makeVideoInfo({ filePath: fp }))
        );

        const result = await service.getLibraryFiles('lib-1');

        expect(result.files[0].fileName).toBe('alpha.mkv');
        expect(result.files[1].fileName).toBe('zebra.mkv');
      });

      it('accumulates totalSizeBytes across all files', async () => {
        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield '/mnt/user/media/Movies/a.mkv';
          yield '/mnt/user/media/Movies/b.mkv';
        });

        mockLibraryRepo.findByWhere.mockResolvedValue(makeLibrary());
        mockMediaAnalysis.probeVideoFile.mockImplementation((fp: string) =>
          Promise.resolve(makeVideoInfo({ filePath: fp, sizeBytes: 500_000_000 }))
        );

        const result = await service.getLibraryFiles('lib-1');

        expect(result.totalSizeBytes).toBe('1000000000');
      });
    });

    describe('NotFoundException', () => {
      it('throws when library is not found', async () => {
        mockLibraryRepo.findByWhere.mockResolvedValue(null);

        await expect(service.getLibraryFiles('missing-lib')).rejects.toThrow(
          new NotFoundException('Library with ID "missing-lib" not found')
        );
      });
    });

    describe('probe failures', () => {
      it('excludes files that fail to probe from the results', async () => {
        const goodPath = '/mnt/user/media/Movies/good.mkv';
        const badPath = '/mnt/user/media/Movies/bad.mkv';

        jest.spyOn(service, 'scanDirectoryStream').mockImplementation(async function* () {
          yield goodPath;
          yield badPath;
        });

        mockLibraryRepo.findByWhere.mockResolvedValue(makeLibrary());
        mockMediaAnalysis.probeVideoFile.mockImplementation((fp: string) =>
          fp === goodPath
            ? Promise.resolve(makeVideoInfo({ filePath: goodPath }))
            : Promise.resolve(null)
        );

        const result = await service.getLibraryFiles('lib-1');

        expect(result.totalFiles).toBe(1);
        expect(result.files[0].filePath).toBe(goodPath);
      });
    });
  });
});
