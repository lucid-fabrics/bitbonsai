import { Test, type TestingModule } from '@nestjs/testing';
import { JobRepository } from '../../../common/repositories/job.repository';
import { NodesService } from '../../../nodes/nodes.service';
import { QueueService } from '../../../queue/queue.service';
import { EncodingWatchdogService } from '../../encoding-watchdog.service';
import { FfmpegService } from '../../ffmpeg.service';
import { SystemResourceService } from '../../system-resource.service';
import { WorkerPoolService } from '../../worker-pool.service';

jest.mock('@prisma/client', () => ({
  PrismaClient: class PrismaClient {},
  JobStage: {
    QUEUED: 'QUEUED',
    ENCODING: 'ENCODING',
    PAUSED_LOAD: 'PAUSED_LOAD',
    DONE: 'DONE',
    FAILED: 'FAILED',
  },
}));
jest.mock('../../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('node:os', () => ({
  loadavg: jest.fn().mockReturnValue([1.0, 1.0, 1.0]),
  cpus: jest.fn().mockReturnValue(Array(4).fill({})),
  totalmem: jest.fn().mockReturnValue(16 * 1024 ** 3),
  freemem: jest.fn().mockReturnValue(8 * 1024 ** 3),
  networkInterfaces: jest.fn().mockReturnValue({}),
}));

import * as os from 'node:os';

describe('EncodingWatchdogService', () => {
  let service: EncodingWatchdogService;
  let jobRepository: jest.Mocked<JobRepository>;
  let queueService: jest.Mocked<QueueService>;
  let nodesService: jest.Mocked<NodesService>;
  let ffmpegService: jest.Mocked<FfmpegService>;
  let systemResourceService: jest.Mocked<SystemResourceService>;
  let workerPoolService: jest.Mocked<WorkerPoolService>;

  beforeEach(async () => {
    jobRepository = {
      findManyWithInclude: jest.fn(),
      countWhere: jest.fn(),
    } as unknown as jest.Mocked<JobRepository>;

    queueService = {
      update: jest.fn().mockResolvedValue(undefined),
      failJob: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<QueueService>;

    nodesService = {
      getCurrentNode: jest.fn(),
    } as unknown as jest.Mocked<NodesService>;

    ffmpegService = {
      killAllZombieFfmpegProcesses: jest.fn().mockResolvedValue({ killed: 0, failed: 0 }),
      killProcess: jest.fn().mockResolvedValue(false),
      getLastStderr: jest.fn().mockReturnValue(null),
      hasActiveProcess: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<FfmpegService>;

    systemResourceService = {
      defaultWorkersPerNode: 2,
      getLoadThresholdMultiplier: jest.fn().mockReturnValue(5.0),
    } as unknown as jest.Mocked<SystemResourceService>;

    workerPoolService = {
      getAllWorkers: jest.fn().mockReturnValue(new Map()),
    } as unknown as jest.Mocked<WorkerPoolService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncodingWatchdogService,
        { provide: JobRepository, useValue: jobRepository },
        { provide: QueueService, useValue: queueService },
        { provide: NodesService, useValue: nodesService },
        { provide: FfmpegService, useValue: ffmpegService },
        { provide: SystemResourceService, useValue: systemResourceService },
        { provide: WorkerPoolService, useValue: workerPoolService },
      ],
    }).compile();

    service = module.get<EncodingWatchdogService>(EncodingWatchdogService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startStuckJobWatchdog', () => {
    it('returns an interval ID', () => {
      jest.useFakeTimers();
      jobRepository.findManyWithInclude.mockResolvedValue([]);
      nodesService.getCurrentNode.mockResolvedValue(null as never);

      const interval = service.startStuckJobWatchdog();
      expect(interval).not.toBeUndefined();
      clearInterval(interval);
      jest.useRealTimers();
    });
  });

  describe('manageLoadBasedPausing', () => {
    it('returns early on win32', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      await expect(service.manageLoadBasedPausing()).resolves.toBeUndefined();
      expect(nodesService.getCurrentNode).not.toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('returns early when current node not found', async () => {
      nodesService.getCurrentNode.mockResolvedValue(null as never);
      await expect(service.manageLoadBasedPausing()).resolves.toBeUndefined();
    });

    it('does not pause/resume when load is normal and no paused jobs', async () => {
      const currentNode = { id: 'node-1', maxWorkers: 4 };
      nodesService.getCurrentNode.mockResolvedValue(currentNode as never);
      jobRepository.countWhere
        .mockResolvedValueOnce(2) // encoding jobs
        .mockResolvedValueOnce(0); // paused jobs

      jest.spyOn(os, 'loadavg').mockReturnValue([1.0, 1.0, 1.0]);
      jest.spyOn(os, 'cpus').mockReturnValue(Array(4).fill({}) as os.CpuInfo[]);

      await service.manageLoadBasedPausing();
      expect(queueService.update).not.toHaveBeenCalled();
    });

    it('pauses jobs when load is moderate (> 1x multiplier)', async () => {
      const currentNode = { id: 'node-1', maxWorkers: 10 };
      nodesService.getCurrentNode.mockResolvedValue(currentNode as never);
      // cpus=1, load=6 → ratio=6 > normalThreshold=5 → moderate → targetWorkers=ceil(10*0.8)=8
      // encodingJobs=10 > targetWorkers=8 → jobsToPause=2
      jobRepository.countWhere.mockResolvedValueOnce(10).mockResolvedValueOnce(0);

      jest.spyOn(os, 'loadavg').mockReturnValue([6.0, 6.0, 6.0]);
      jest.spyOn(os, 'cpus').mockReturnValue(Array(1).fill({}) as os.CpuInfo[]);

      jobRepository.findManyWithInclude.mockResolvedValue([
        { id: 'job-2', fileLabel: 'b.mkv', priority: 1 },
      ]);

      await service.manageLoadBasedPausing();
      expect(queueService.update).toHaveBeenCalledWith(
        'job-2',
        expect.objectContaining({ stage: 'PAUSED_LOAD' })
      );
    });

    it('resumes paused jobs when load drops', async () => {
      const currentNode = { id: 'node-1', maxWorkers: 4 };
      nodesService.getCurrentNode.mockResolvedValue(currentNode as never);
      jobRepository.countWhere
        .mockResolvedValueOnce(1) // encoding < targetWorkers
        .mockResolvedValueOnce(2); // paused > 0

      jest.spyOn(os, 'loadavg').mockReturnValue([1.0, 1.0, 1.0]);
      jest.spyOn(os, 'cpus').mockReturnValue(Array(4).fill({}) as os.CpuInfo[]);

      jobRepository.findManyWithInclude.mockResolvedValue([
        { id: 'job-3', fileLabel: 'c.mkv', priority: 5 },
      ]);

      await service.manageLoadBasedPausing();
      expect(queueService.update).toHaveBeenCalledWith(
        'job-3',
        expect.objectContaining({ stage: 'QUEUED' })
      );
    });

    it('uses emergency (30%) workers when load is critical', async () => {
      const currentNode = { id: 'node-1', maxWorkers: 10 };
      nodesService.getCurrentNode.mockResolvedValue(currentNode as never);
      // ratio=80/1=80 > highThreshold=15
      jobRepository.countWhere.mockResolvedValueOnce(10).mockResolvedValueOnce(0);

      jest.spyOn(os, 'loadavg').mockReturnValue([80, 80, 80]);
      jest.spyOn(os, 'cpus').mockReturnValue(Array(1).fill({}) as os.CpuInfo[]);

      jobRepository.findManyWithInclude.mockResolvedValue([
        { id: 'job-4', fileLabel: 'd.mkv', priority: 1 },
      ]);

      await service.manageLoadBasedPausing();
      expect(queueService.update).toHaveBeenCalled();
    });

    it('uses node maxWorkers when set', async () => {
      const currentNode = { id: 'node-1', maxWorkers: 6 };
      nodesService.getCurrentNode.mockResolvedValue(currentNode as never);
      jobRepository.countWhere.mockResolvedValueOnce(2).mockResolvedValueOnce(0);

      jest.spyOn(os, 'loadavg').mockReturnValue([1.0, 1.0, 1.0]);
      jest.spyOn(os, 'cpus').mockReturnValue(Array(4).fill({}) as os.CpuInfo[]);

      await service.manageLoadBasedPausing();
      // Normal load, no pausing needed
      expect(queueService.update).not.toHaveBeenCalled();
    });
  });

  describe('getSystemDiagnostics', () => {
    it('returns diagnostics string on non-win32', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      ffmpegService.hasActiveProcess.mockReturnValue(true);
      workerPoolService.getAllWorkers.mockReturnValue(
        new Map([['w1', { currentJobId: 'job-1' }]]) as never
      );

      const result = await service.getSystemDiagnostics('job-1');
      expect(result).toContain('System Diagnostics:');
      expect(result).toContain('Memory:');
      expect(result).toContain('Load average:');
      expect(result).toContain('Active workers: 1/1');
      expect(result).toContain('FFmpeg process active: Yes');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('omits load average on win32', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      ffmpegService.hasActiveProcess.mockReturnValue(false);
      workerPoolService.getAllWorkers.mockReturnValue(new Map());

      const result = await service.getSystemDiagnostics('job-1');
      expect(result).not.toContain('Load average:');
      expect(result).toContain('FFmpeg process active: No');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('handles os errors gracefully', async () => {
      jest.spyOn(os, 'totalmem').mockImplementation(() => {
        throw new Error('os error');
      });

      const result = await service.getSystemDiagnostics('job-1');
      expect(result).toContain('Diagnostic collection failed');
    });
  });
});
