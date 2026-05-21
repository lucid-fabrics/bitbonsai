import { Test, type TestingModule } from '@nestjs/testing';
import { NodeConfigService } from '../../../../core/services/node-config.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TempFileGuardService } from '../../temp-file-guard.service';

// ---------------------------------------------------------------------------
// fs mock — must be declared before imports that resolve node:fs
// ---------------------------------------------------------------------------
const mockUnlink = jest.fn();

jest.mock('node:fs', () => ({
  // Sync surface required by @prisma/client at import time
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  // Async surface used by TempFileGuardService
  promises: {
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrisma() {
  return {
    jobTempFile: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

function makeNodeConfig(nodeId: string | null = 'node-abc') {
  return { getNodeId: jest.fn().mockReturnValue(nodeId) };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TempFileGuardService', () => {
  let service: TempFileGuardService;
  let prisma: ReturnType<typeof makePrisma>;
  let nodeConfig: ReturnType<typeof makeNodeConfig>;

  async function buildModule(nodeId: string | null = 'node-abc') {
    prisma = makePrisma();
    nodeConfig = makeNodeConfig(nodeId);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TempFileGuardService,
        { provide: PrismaService, useValue: prisma },
        { provide: NodeConfigService, useValue: nodeConfig },
      ],
    }).compile();

    // compile() triggers onModuleInit — stub it out so it doesn't run implicitly
    service = module.get<TempFileGuardService>(TempFileGuardService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: no stale rows so onModuleInit is a no-op
    await buildModule();
    prisma.jobTempFile.findMany.mockResolvedValue([]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==========================================================================
  // registerTempFile
  // ==========================================================================
  describe('registerTempFile', () => {
    const JOB_ID = 'job-1';
    const TEMP_PATH = '/tmp/job-1.mkv.tmp';
    const NODE_ID = 'node-abc';

    it('creates a row when no existing uncleaned row exists', async () => {
      prisma.jobTempFile.findFirst.mockResolvedValue(null);
      prisma.jobTempFile.create.mockResolvedValue({ id: 'row-1' });

      await service.registerTempFile(JOB_ID, TEMP_PATH, NODE_ID);

      expect(prisma.jobTempFile.findFirst).toHaveBeenCalledWith({
        where: { jobId: JOB_ID, tempPath: TEMP_PATH, cleanedAt: null },
        select: { id: true },
      });
      expect(prisma.jobTempFile.create).toHaveBeenCalledWith({
        data: { jobId: JOB_ID, tempPath: TEMP_PATH, nodeId: NODE_ID },
      });
    });

    it('skips create when an uncleaned row already exists (resume case)', async () => {
      prisma.jobTempFile.findFirst.mockResolvedValue({ id: 'existing-row' });

      await service.registerTempFile(JOB_ID, TEMP_PATH, NODE_ID);

      expect(prisma.jobTempFile.create).not.toHaveBeenCalled();
    });

    it('does not throw when prisma.findFirst rejects', async () => {
      prisma.jobTempFile.findFirst.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.registerTempFile(JOB_ID, TEMP_PATH, NODE_ID)).resolves.toBeUndefined();
      expect(prisma.jobTempFile.create).not.toHaveBeenCalled();
    });

    it('does not throw when prisma.create rejects', async () => {
      prisma.jobTempFile.findFirst.mockResolvedValue(null);
      prisma.jobTempFile.create.mockRejectedValue(new Error('Unique constraint'));

      await expect(service.registerTempFile(JOB_ID, TEMP_PATH, NODE_ID)).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // markCleaned
  // ==========================================================================
  describe('markCleaned', () => {
    const TEMP_PATH = '/tmp/job-1.mkv.tmp';

    it('calls updateMany with the correct where clause', async () => {
      prisma.jobTempFile.updateMany.mockResolvedValue({ count: 1 });

      await service.markCleaned(TEMP_PATH);

      expect(prisma.jobTempFile.updateMany).toHaveBeenCalledWith({
        where: { tempPath: TEMP_PATH, cleanedAt: null },
        data: { cleanedAt: expect.any(Date) },
      });
    });

    it('does not throw when updateMany rejects', async () => {
      prisma.jobTempFile.updateMany.mockRejectedValue(new Error('timeout'));

      await expect(service.markCleaned(TEMP_PATH)).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // cleanupJobTempFiles  (exercises unlinkAndMark internally)
  // ==========================================================================
  describe('cleanupJobTempFiles', () => {
    const JOB_ID = 'job-2';

    it('calls unlink and marks row cleaned for each uncleaned row', async () => {
      const rows = [
        { id: 'row-1', tempPath: '/tmp/a.mkv.tmp' },
        { id: 'row-2', tempPath: '/mnt/nfs/b.mkv.tmp' },
      ];
      prisma.jobTempFile.findMany.mockResolvedValue(rows);
      mockUnlink.mockResolvedValue(undefined);
      prisma.jobTempFile.update.mockResolvedValue({});

      await service.cleanupJobTempFiles(JOB_ID);

      expect(prisma.jobTempFile.findMany).toHaveBeenCalledWith({
        where: { jobId: JOB_ID, cleanedAt: null },
        select: { id: true, tempPath: true },
      });
      expect(mockUnlink).toHaveBeenCalledTimes(2);
      expect(mockUnlink).toHaveBeenCalledWith('/tmp/a.mkv.tmp');
      expect(mockUnlink).toHaveBeenCalledWith('/mnt/nfs/b.mkv.tmp');
      expect(prisma.jobTempFile.update).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no uncleaned rows exist', async () => {
      prisma.jobTempFile.findMany.mockResolvedValue([]);

      await service.cleanupJobTempFiles(JOB_ID);

      expect(mockUnlink).not.toHaveBeenCalled();
      expect(prisma.jobTempFile.update).not.toHaveBeenCalled();
    });

    it('returns early without throwing when findMany rejects', async () => {
      prisma.jobTempFile.findMany.mockRejectedValue(new Error('DB down'));

      await expect(service.cleanupJobTempFiles(JOB_ID)).resolves.toBeUndefined();
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // unlinkAndMark — path validation (tested via cleanupJobTempFiles)
    // -------------------------------------------------------------------------
    describe('unlinkAndMark path validation', () => {
      it.each([
        '/etc/passwd',
        '/home/user/.ssh/id_rsa',
        '/root/secret',
        'relative/path/file.tmp',
        '',
      ])('rejects suspicious path "%s" — no unlink, no DB update', async (badPath) => {
        prisma.jobTempFile.findMany.mockResolvedValue([{ id: 'row-1', tempPath: badPath }]);

        await service.cleanupJobTempFiles(JOB_ID);

        expect(mockUnlink).not.toHaveBeenCalled();
        expect(prisma.jobTempFile.update).not.toHaveBeenCalled();
      });

      it.each(['/tmp/', '/var/tmp/', '/mnt/', '/media/', '/nfs/', '/data/'])(
        'allows paths starting with "%s"',
        async (prefix) => {
          const safePath = `${prefix}job.mkv.tmp`;
          prisma.jobTempFile.findMany.mockResolvedValue([{ id: 'row-1', tempPath: safePath }]);
          mockUnlink.mockResolvedValue(undefined);
          prisma.jobTempFile.update.mockResolvedValue({});

          await service.cleanupJobTempFiles(JOB_ID);

          expect(mockUnlink).toHaveBeenCalledWith(safePath);
        }
      );

      it('ignores ENOENT on unlink (file already gone) and still marks cleaned', async () => {
        prisma.jobTempFile.findMany.mockResolvedValue([
          { id: 'row-1', tempPath: '/tmp/gone.mkv.tmp' },
        ]);
        const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        mockUnlink.mockRejectedValue(enoent);
        prisma.jobTempFile.update.mockResolvedValue({});

        await service.cleanupJobTempFiles(JOB_ID);

        // Should still update the DB row as cleaned
        expect(prisma.jobTempFile.update).toHaveBeenCalledWith({
          where: { id: 'row-1' },
          data: { cleanedAt: expect.any(Date) },
        });
      });

      it('marks row cleaned even when unlink fails with a non-ENOENT error', async () => {
        prisma.jobTempFile.findMany.mockResolvedValue([
          { id: 'row-1', tempPath: '/tmp/busy.mkv.tmp' },
        ]);
        const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' });
        mockUnlink.mockRejectedValue(eperm);
        prisma.jobTempFile.update.mockResolvedValue({});

        await service.cleanupJobTempFiles(JOB_ID);

        expect(prisma.jobTempFile.update).toHaveBeenCalled();
      });

      it('returns false (no DB update) when prisma.update rejects', async () => {
        prisma.jobTempFile.findMany.mockResolvedValue([
          { id: 'row-1', tempPath: '/tmp/ok.mkv.tmp' },
        ]);
        mockUnlink.mockResolvedValue(undefined);
        prisma.jobTempFile.update.mockRejectedValue(new Error('DB error'));

        // Should not throw — just logs warning
        await expect(service.cleanupJobTempFiles(JOB_ID)).resolves.toBeUndefined();
      });
    });
  });

  // ==========================================================================
  // cleanupStaleTempFiles (onModuleInit)
  // ==========================================================================
  describe('cleanupStaleTempFiles', () => {
    it('skips cleanup when nodeId is unavailable', async () => {
      await buildModule(null /* nodeId = null */);
      // Reset mocks after re-building the module
      jest.clearAllMocks();

      await service.cleanupStaleTempFiles();

      expect(prisma.jobTempFile.findMany).not.toHaveBeenCalled();
    });

    it('queries by nodeId and calls unlinkAndMark for stale rows', async () => {
      const rows = [{ id: 'stale-1', tempPath: '/tmp/stale.mkv.tmp', jobId: 'job-x' }];
      prisma.jobTempFile.findMany.mockResolvedValue(rows);
      mockUnlink.mockResolvedValue(undefined);
      prisma.jobTempFile.update.mockResolvedValue({});

      await service.cleanupStaleTempFiles();

      expect(prisma.jobTempFile.findMany).toHaveBeenCalledWith({
        where: { cleanedAt: null, nodeId: 'node-abc' },
        select: { id: true, tempPath: true, jobId: true },
      });
      expect(mockUnlink).toHaveBeenCalledWith('/tmp/stale.mkv.tmp');
    });

    it('logs and returns when no stale rows found', async () => {
      prisma.jobTempFile.findMany.mockResolvedValue([]);

      await expect(service.cleanupStaleTempFiles()).resolves.toBeUndefined();

      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('returns early without throwing when findMany rejects', async () => {
      prisma.jobTempFile.findMany.mockRejectedValue(new Error('startup DB error'));

      await expect(service.cleanupStaleTempFiles()).resolves.toBeUndefined();
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('counts only successfully marked rows in the summary log', async () => {
      const rows = [
        { id: 'stale-1', tempPath: '/tmp/good.mkv.tmp', jobId: 'job-1' },
        { id: 'stale-2', tempPath: '/tmp/bad.mkv.tmp', jobId: 'job-2' },
      ];
      prisma.jobTempFile.findMany.mockResolvedValue(rows);
      mockUnlink.mockResolvedValue(undefined);
      // First update succeeds, second fails → only 1 removed
      prisma.jobTempFile.update
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('DB flake'));

      await expect(service.cleanupStaleTempFiles()).resolves.toBeUndefined();

      expect(prisma.jobTempFile.update).toHaveBeenCalledTimes(2);
    });
  });
});
