jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn() }));
jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    unlink: jest.fn(),
    writeFile: jest.fn(),
    stat: jest.fn(),
    rmdir: jest.fn(),
  },
}));

import { Test, type TestingModule } from '@nestjs/testing';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import * as path from 'path';
import { NodeConfigService } from '../../../core/services/node-config.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SegmentedEncodeService, type SegmentPlan } from '../../services/segmented-encode.service';

describe('SegmentedEncodeService', () => {
  let service: SegmentedEncodeService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nodeConfig: any;

  const mockPrisma = {
    jobSegment: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockNodeConfig = {
    getNodeId: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SegmentedEncodeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NodeConfigService, useValue: mockNodeConfig },
      ],
    }).compile();

    service = module.get<SegmentedEncodeService>(SegmentedEncodeService);
    prisma = mockPrisma;
    nodeConfig = mockNodeConfig;

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  const createMockProcess = (exitCode: number, stdout: string, stderr = '') => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdout.destroy = jest.fn();
    proc.stderr.destroy = jest.fn();
    proc.kill = jest.fn();

    (spawn as jest.Mock).mockReturnValue(proc);

    setTimeout(() => {
      if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', exitCode);
    }, 10);

    return proc;
  };

  describe('shouldUseSegmentedEncode', () => {
    it('should return false when segmented encoding is disabled', () => {
      const result = service.shouldUseSegmentedEncode(7200, false, 30);
      expect(result).toBe(false);
    });

    it('should return false when enabled but duration is below threshold', () => {
      const result = service.shouldUseSegmentedEncode(1799, true, 30);
      expect(result).toBe(false);
    });

    it('should return true when enabled and duration is at exact threshold', () => {
      const result = service.shouldUseSegmentedEncode(1800, true, 30);
      expect(result).toBe(true);
    });

    it('should return true when enabled and duration is above threshold', () => {
      const result = service.shouldUseSegmentedEncode(3600, true, 30);
      expect(result).toBe(true);
    });
  });

  describe('planSegments', () => {
    it('should create 12 segments for 3600s source with 300s segments', () => {
      const segmentsDir = '/tmp/job-123/segments';
      const segmentDurationSecs = 300;

      const plan = service.planSegments('job-123', 3600, segmentsDir, segmentDurationSecs);

      expect(plan.segments).toHaveLength(12);
      expect(plan.totalSegments).toBe(12);
      expect(plan.segmentsDir).toBe(segmentsDir);

      plan.segments.forEach((seg, i) => {
        expect(seg.index).toBe(i);
        expect(seg.startSeconds).toBe(i * 300);
        expect(seg.endSeconds).toBe((i + 1) * 300);
        expect(seg.durationSeconds).toBe(300);
        expect(seg.tempPath).toBe(path.join(segmentsDir, `seg_${String(i).padStart(4, '0')}.mkv`));
      });
    });

    it('should create 13 segments when last segment is shorter than segment duration', () => {
      const segmentsDir = '/tmp/job-456/segments';
      const segmentDurationSecs = 300;
      const sourceDurationSeconds = 3650; // 12 * 300 = 3600, remainder = 50

      const plan = service.planSegments(
        'job-456',
        sourceDurationSeconds,
        segmentsDir,
        segmentDurationSecs
      );

      expect(plan.segments).toHaveLength(13);
      expect(plan.totalSegments).toBe(13);

      // First 12 segments should be full 300s
      for (let i = 0; i < 12; i++) {
        expect(plan.segments[i].durationSeconds).toBe(300);
        expect(plan.segments[i].startSeconds).toBe(i * 300);
        expect(plan.segments[i].endSeconds).toBe((i + 1) * 300);
      }

      // Last segment should be 50s
      const lastSeg = plan.segments[12];
      expect(lastSeg.index).toBe(12);
      expect(lastSeg.startSeconds).toBe(3600);
      expect(lastSeg.endSeconds).toBe(3650);
      expect(lastSeg.durationSeconds).toBe(50);
      expect(lastSeg.tempPath).toBe(path.join(segmentsDir, 'seg_0012.mkv'));
    });

    it('should set concatListPath to segmentsDir/concat.txt', () => {
      const segmentsDir = '/tmp/job-789/segments';

      const plan = service.planSegments('job-789', 600, segmentsDir, 300);

      expect(plan.concatListPath).toBe(path.join(segmentsDir, 'concat.txt'));
    });
  });

  describe('verifySegment', () => {
    it('should resolve with actual duration when within tolerance', async () => {
      const segmentPath = '/tmp/seg_0001.mkv';
      const expectedDuration = 300;
      const actualDuration = 299.5;

      createMockProcess(0, actualDuration.toString());

      const result = await service.verifySegment(segmentPath, expectedDuration);

      expect(result).toBeCloseTo(actualDuration, 1);
      expect(spawn).toHaveBeenCalledWith(
        'ffprobe',
        expect.arrayContaining([
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'csv=p=0',
          segmentPath,
        ])
      );
    });

    it('should reject when duration mismatch exceeds tolerance', async () => {
      const segmentPath = '/tmp/seg_0001.mkv';
      const expectedDuration = 300;
      const actualDuration = 280; // 20s difference, exceeds 2s max tolerance

      createMockProcess(0, actualDuration.toString());

      await expect(service.verifySegment(segmentPath, expectedDuration)).rejects.toThrow(
        /duration mismatch/
      );
    });

    it('should pass short last segment with proportional tolerance (min 0.5s)', async () => {
      const segmentPath = '/tmp/seg_0012.mkv';
      const expectedDuration = 4;
      const actualDuration = 3.9; // 0.1s difference, within 0.5s min tolerance

      createMockProcess(0, actualDuration.toString());

      const result = await service.verifySegment(segmentPath, expectedDuration);

      expect(result).toBeCloseTo(actualDuration, 1);
    });

    it('should reject when ffprobe times out', async () => {
      jest.useFakeTimers();
      const segmentPath = '/tmp/seg_0001.mkv';
      const expectedDuration = 300;

      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout.destroy = jest.fn();
      proc.stderr.destroy = jest.fn();
      proc.kill = jest.fn();

      (spawn as jest.Mock).mockReturnValue(proc);

      const rejectPromise = expect(
        service.verifySegment(segmentPath, expectedDuration)
      ).rejects.toThrow('ffprobe timeout');
      jest.advanceTimersByTime(16_000);
      await rejectPromise;
      expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
      jest.useRealTimers();
    });

    it('should reject when ffprobe exits with non-zero code', async () => {
      const segmentPath = '/tmp/seg_0001.mkv';
      const expectedDuration = 300;

      createMockProcess(1, '', 'Error opening input');

      await expect(service.verifySegment(segmentPath, expectedDuration)).rejects.toThrow(
        /ffprobe exited 1/
      );
    });

    it('should reject when ffprobe returns non-numeric duration', async () => {
      const segmentPath = '/tmp/seg_0001.mkv';
      const expectedDuration = 300;

      createMockProcess(0, 'not a number');

      await expect(service.verifySegment(segmentPath, expectedDuration)).rejects.toThrow(
        /non-numeric duration/
      );
    });
  });

  describe('findResumePoint', () => {
    it('should return last verified index and null partial when all segments verified', async () => {
      const jobId = 'job-123';
      const segments = [
        { segmentIndex: 0, completedAt: new Date(), verifiedAt: new Date(), tempPath: '/seg0' },
        { segmentIndex: 1, completedAt: new Date(), verifiedAt: new Date(), tempPath: '/seg1' },
        { segmentIndex: 2, completedAt: new Date(), verifiedAt: new Date(), tempPath: '/seg2' },
      ];

      mockPrisma.jobSegment.findMany.mockResolvedValue(segments as any);

      const result = await service.findResumePoint(jobId);

      expect(result.lastVerifiedIndex).toBe(2);
      expect(result.partialSegmentIndex).toBeNull();
    });

    it('should return partial segment index when last segment is completed but not verified', async () => {
      const jobId = 'job-456';
      const segments = [
        { segmentIndex: 0, completedAt: new Date(), verifiedAt: new Date(), tempPath: '/seg0' },
        { segmentIndex: 1, completedAt: new Date(), verifiedAt: new Date(), tempPath: '/seg1' },
        { segmentIndex: 2, completedAt: new Date(), verifiedAt: null, tempPath: '/seg2' },
      ];

      mockPrisma.jobSegment.findMany.mockResolvedValue(segments as any);

      const result = await service.findResumePoint(jobId);

      expect(result.lastVerifiedIndex).toBe(1);
      expect(result.partialSegmentIndex).toBe(2);
    });
  });

  describe('persistSegmentPlan', () => {
    it('should create segment records within transaction', async () => {
      const jobId = 'job-789';
      const nodeId = 'node-1';
      const plan: SegmentPlan = {
        segments: [
          { index: 0, startSeconds: 0, endSeconds: 300, durationSeconds: 300, tempPath: '/seg0' },
          { index: 1, startSeconds: 300, endSeconds: 600, durationSeconds: 300, tempPath: '/seg1' },
        ],
        segmentsDir: '/tmp/segments',
        concatListPath: '/tmp/segments/concat.txt',
        totalSegments: 2,
      };

      nodeConfig.getNodeId.mockReturnValue(nodeId);
      mockPrisma.jobSegment.create.mockResolvedValue({});
      mockPrisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) =>
        Promise.all(ops)
      );

      await service.persistSegmentPlan(jobId, plan);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.jobSegment.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.jobSegment.create).toHaveBeenCalledWith({
        data: {
          jobId,
          segmentIndex: 0,
          startSeconds: 0,
          endSeconds: 300,
          durationSeconds: 300,
          tempPath: '/seg0',
          nodeId,
        },
      });
    });
  });

  describe('markSegmentCompleted', () => {
    it('should update segment completedAt timestamp', async () => {
      const jobId = 'job-101';
      const segmentIndex = 5;

      await service.markSegmentCompleted(jobId, segmentIndex);

      expect(mockPrisma.jobSegment.update).toHaveBeenCalledWith({
        where: { jobId_segmentIndex: { jobId, segmentIndex } },
        data: { completedAt: expect.any(Date) },
      });
    });
  });

  describe('markSegmentVerified', () => {
    it('should update segment with verified data and file stats', async () => {
      const jobId = 'job-102';
      const segmentIndex = 3;
      const actualDuration = 299.5;
      const tempPath = '/tmp/seg_0003.mkv';
      const mockStat = { size: 1048576 };

      (fs.stat as jest.Mock).mockResolvedValue(mockStat);

      await service.markSegmentVerified(jobId, segmentIndex, actualDuration, tempPath);

      expect(mockPrisma.jobSegment.update).toHaveBeenCalledWith({
        where: { jobId_segmentIndex: { jobId, segmentIndex } },
        data: {
          verifiedAt: expect.any(Date),
          durationVerified: actualDuration,
          sizeBytes: BigInt(mockStat.size),
        },
      });
    });

    it('should handle missing file stats gracefully', async () => {
      const jobId = 'job-103';
      const segmentIndex = 4;
      const actualDuration = 300;
      const tempPath = '/tmp/missing.mkv';

      (fs.stat as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      await service.markSegmentVerified(jobId, segmentIndex, actualDuration, tempPath);

      expect(mockPrisma.jobSegment.update).toHaveBeenCalledWith({
        where: { jobId_segmentIndex: { jobId, segmentIndex } },
        data: {
          verifiedAt: expect.any(Date),
          durationVerified: actualDuration,
          sizeBytes: null,
        },
      });
    });
  });

  describe('resetPartialSegment', () => {
    it('should delete file and reset segment record', async () => {
      const jobId = 'job-104';
      const segmentIndex = 2;
      const tempPath = '/tmp/seg_0002.mkv';

      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      await service.resetPartialSegment(jobId, segmentIndex, tempPath);

      expect(fs.unlink).toHaveBeenCalledWith(tempPath);
      expect(mockPrisma.jobSegment.update).toHaveBeenCalledWith({
        where: { jobId_segmentIndex: { jobId, segmentIndex } },
        data: {
          completedAt: null,
          verifiedAt: null,
          durationVerified: null,
          sizeBytes: null,
        },
      });
    });
  });

  describe('concatSegments', () => {
    it('should write concat list and run ffmpeg concat', async () => {
      const concatListPath = '/tmp/segments/concat.txt';
      const segmentPaths = ['/tmp/seg_0000.mkv', '/tmp/seg_0001.mkv'];
      const outputPath = '/tmp/output.mkv';
      const sourceFilePath = '/tmp/source.mkv';

      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      createMockProcess(0, '');

      await service.concatSegments(concatListPath, segmentPaths, outputPath, sourceFilePath);

      expect(fs.writeFile).toHaveBeenCalledWith(
        concatListPath,
        expect.stringContaining("file '/tmp/seg_0000.mkv'"),
        'utf8'
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        concatListPath,
        expect.stringContaining("file '/tmp/seg_0001.mkv'"),
        'utf8'
      );
      expect(spawn).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining([
          '-y',
          '-i',
          sourceFilePath,
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatListPath,
          '-map_chapters',
          '0',
          '-map',
          '1',
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          outputPath,
        ])
      );
    });

    it('should reject when ffmpeg concat fails', async () => {
      const concatListPath = '/tmp/segments/concat.txt';
      const segmentPaths = ['/tmp/seg_0000.mkv'];
      const outputPath = '/tmp/output.mkv';
      const sourceFilePath = '/tmp/source.mkv';

      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      createMockProcess(1, '', 'Error during concatenation');

      await expect(
        service.concatSegments(concatListPath, segmentPaths, outputPath, sourceFilePath)
      ).rejects.toThrow(/ffmpeg concat failed/);
    });

    it('should escape special characters in file paths', async () => {
      const concatListPath = '/tmp/segments/concat.txt';
      const segmentPaths = ["/tmp/seg_'with'quotes.mkv", '/tmp/seg_normal.mkv'];
      const outputPath = '/tmp/output.mkv';
      const sourceFilePath = '/tmp/source.mkv';

      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      createMockProcess(0, '');

      await service.concatSegments(concatListPath, segmentPaths, outputPath, sourceFilePath);

      expect(fs.writeFile).toHaveBeenCalledWith(
        concatListPath,
        expect.not.stringContaining("'with'"),
        'utf8'
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        concatListPath,
        expect.stringContaining("\\'"),
        'utf8'
      );
    });
  });

  describe('cleanupSegments', () => {
    it('should delete all segment files and directory', async () => {
      const jobId = 'job-105';
      const segmentsDir = '/tmp/segments';
      const segments = [{ tempPath: '/tmp/seg_0000.mkv' }, { tempPath: '/tmp/seg_0001.mkv' }];

      mockPrisma.jobSegment.findMany.mockResolvedValue(segments as any);
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);
      (fs.rmdir as jest.Mock).mockResolvedValue(undefined);

      await service.cleanupSegments(jobId, segmentsDir);

      expect(fs.unlink).toHaveBeenCalledWith('/tmp/seg_0000.mkv');
      expect(fs.unlink).toHaveBeenCalledWith('/tmp/seg_0001.mkv');
      expect(fs.rmdir).toHaveBeenCalledWith(segmentsDir);
    });

    it('should handle missing segments gracefully', async () => {
      const jobId = 'job-106';
      const segmentsDir = '/tmp/segments';

      mockPrisma.jobSegment.findMany.mockResolvedValue([]);

      await service.cleanupSegments(jobId, segmentsDir);

      expect(fs.unlink).not.toHaveBeenCalled();
      expect(fs.rmdir).not.toHaveBeenCalled();
    });
  });

  describe('getSegments', () => {
    it('should return all segments for a job in order', async () => {
      const jobId = 'job-107';
      const segments = [
        {
          segmentIndex: 0,
          startSeconds: 0,
          endSeconds: 300,
          durationSeconds: 300,
          tempPath: '/seg0',
        },
        {
          segmentIndex: 1,
          startSeconds: 300,
          endSeconds: 600,
          durationSeconds: 300,
          tempPath: '/seg1',
        },
        {
          segmentIndex: 2,
          startSeconds: 600,
          endSeconds: 900,
          durationSeconds: 300,
          tempPath: '/seg2',
        },
      ];

      mockPrisma.jobSegment.findMany.mockResolvedValue(segments as any);

      const result = await service.getSegments(jobId);

      expect(result).toHaveLength(3);
      expect(result[0].index).toBe(0);
      expect(result[1].index).toBe(1);
      expect(result[2].index).toBe(2);
    });
  });
});
