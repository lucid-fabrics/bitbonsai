import { Test, type TestingModule } from '@nestjs/testing';
import { JobRepository } from '../../../../common/repositories/job.repository';
import { FileTransferService } from '../../file-transfer.service';

// Mock child_process
jest.mock('node:child_process', () => ({
  exec: jest.fn(),
  spawn: jest.fn(),
}));

describe('FileTransferService', () => {
  let service: FileTransferService;
  let jobRepository: { updateById: jest.Mock; findUniqueSelect: jest.Mock };

  beforeEach(async () => {
    jobRepository = {
      updateById: jest.fn(),
      findUniqueSelect: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FileTransferService, { provide: JobRepository, useValue: jobRepository }],
    }).compile();

    service = module.get<FileTransferService>(FileTransferService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==========================================================================
  // onModuleInit - orphan process cleanup
  // ==========================================================================
  describe('onModuleInit', () => {
    it('should attempt to kill orphaned SSH/rsync processes', async () => {
      const { exec } = require('node:child_process');
      exec.mockImplementation(
        (_cmd: string, cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        }
      );

      await service.onModuleInit();

      expect(exec).toHaveBeenCalledWith('pkill -f "^(ssh|rsync).*bitbonsai"', expect.any(Function));
    });

    it('should handle no processes found (exit code 1)', async () => {
      const { exec } = require('node:child_process');
      exec.mockImplementation(
        (_cmd: string, cb: (err: { code: number }, stdout: string, stderr: string) => void) => {
          cb({ code: 1 }, '', '');
        }
      );

      // Should not throw
      await service.onModuleInit();
    });

    it('should handle exec errors gracefully', async () => {
      const { exec } = require('node:child_process');
      exec.mockImplementation(() => {
        throw new Error('exec failed');
      });

      // Should not throw - errors are caught
      await service.onModuleInit();
    });
  });

  // ==========================================================================
  // validateRsyncPath (tested via transferFile path validation)
  // ==========================================================================
  describe('path validation', () => {
    const validSourceNode = {
      id: 'src-1',
      name: 'Main',
      ipAddress: '192.168.1.100',
      hasSharedStorage: false,
    };
    const validTargetNode = {
      id: 'tgt-1',
      name: 'Child',
      ipAddress: '192.168.1.170',
      hasSharedStorage: false,
    };

    it('should reject paths with control characters', async () => {
      await expect(
        service.transferFile(
          'job-1',
          '/path/with\x00null',
          validSourceNode as any,
          validTargetNode as any
        )
      ).rejects.toThrow('Path contains control characters or newlines');
    });

    it('should reject paths with newlines', async () => {
      await expect(
        service.transferFile(
          'job-1',
          '/path/with\nnewline',
          validSourceNode as any,
          validTargetNode as any
        )
      ).rejects.toThrow('Path contains control characters or newlines');
    });

    it('should reject paths exceeding 4096 characters', async () => {
      const longPath = `/media/${'a'.repeat(4100)}`;
      await expect(
        service.transferFile('job-1', longPath, validSourceNode as any, validTargetNode as any)
      ).rejects.toThrow('Path exceeds maximum length');
    });

    it('should reject paths with spaces (shell expansion prevention)', async () => {
      await expect(
        service.transferFile(
          'job-1',
          '/path/with spaces/file.mkv',
          validSourceNode as any,
          validTargetNode as any
        )
      ).rejects.toThrow('Invalid path characters detected');
    });

    it('should reject path traversal attempts', async () => {
      await expect(
        service.transferFile(
          'job-1',
          '/media/../etc/passwd',
          validSourceNode as any,
          validTargetNode as any
        )
      ).rejects.toThrow('Path traversal attempt detected');
    });

    it('should reject paths with colon characters (covers rsync daemon syntax)', async () => {
      await expect(
        service.transferFile(
          'job-1',
          '/media::module/file.mkv',
          validSourceNode as any,
          validTargetNode as any
        )
      ).rejects.toThrow('Invalid path characters detected');
    });

    it('should reject invalid IP addresses on target node', async () => {
      const badTarget = { ...validTargetNode, ipAddress: '999.999.999.999' };
      await expect(
        service.transferFile('job-1', '/media/file.mkv', validSourceNode as any, badTarget as any)
      ).rejects.toThrow('Invalid IP address format');
    });

    it('should reject target node with no IP address', async () => {
      const noIpTarget = { ...validTargetNode, ipAddress: null };
      await expect(
        service.transferFile('job-1', '/media/file.mkv', validSourceNode as any, noIpTarget as any)
      ).rejects.toThrow('has no IP address');
    });
  });

  // ==========================================================================
  // transferFile - shared storage skip
  // ==========================================================================
  describe('transferFile', () => {
    it('should skip transfer when target has shared storage', async () => {
      const sourceNode = { id: 'src-1', name: 'Main' } as any;
      const targetNode = {
        id: 'tgt-1',
        name: 'Child',
        hasSharedStorage: true,
      } as any;

      await service.transferFile('job-1', '/media/file.mkv', sourceNode, targetNode);

      expect(jobRepository.updateById).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // getTransferProgress
  // ==========================================================================
  describe('getTransferProgress', () => {
    it('should return PENDING status for detected jobs', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue({
        id: 'job-1',
        stage: 'DETECTED',
        transferRequired: true,
        transferProgress: 0,
        transferSpeedMBps: null,
        transferError: null,
        beforeSizeBytes: BigInt(1073741824), // 1GB
      });

      const result = await service.getTransferProgress('job-1');

      expect(result.status).toBe('PENDING');
      expect(result.progress).toBe(0);
      expect(result.jobId).toBe('job-1');
    });

    it('should return TRANSFERRING status for active transfers', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue({
        id: 'job-1',
        stage: 'TRANSFERRING',
        transferRequired: true,
        transferProgress: 50,
        transferSpeedMBps: 10.5,
        transferError: null,
        beforeSizeBytes: BigInt(1073741824),
      });

      const result = await service.getTransferProgress('job-1');

      expect(result.status).toBe('TRANSFERRING');
      expect(result.progress).toBe(50);
      expect(result.speedMBps).toBe(10.5);
    });

    it('should return COMPLETED status when progress is 100', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue({
        id: 'job-1',
        stage: 'QUEUED',
        transferRequired: true,
        transferProgress: 100,
        transferSpeedMBps: 15.0,
        transferError: null,
        beforeSizeBytes: BigInt(1073741824),
      });

      const result = await service.getTransferProgress('job-1');

      expect(result.status).toBe('COMPLETED');
      expect(result.bytesTransferred).toBe(BigInt(1073741824));
    });

    it('should return FAILED status when transferError exists', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue({
        id: 'job-1',
        stage: 'FAILED',
        transferRequired: true,
        transferProgress: 30,
        transferSpeedMBps: null,
        transferError: 'Connection refused',
        beforeSizeBytes: BigInt(1073741824),
      });

      const result = await service.getTransferProgress('job-1');

      expect(result.status).toBe('FAILED');
      expect(result.error).toBe('Connection refused');
    });

    it('should throw when job not found', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue(null);

      await expect(service.getTransferProgress('nonexistent')).rejects.toThrow(
        'Job nonexistent not found'
      );
    });

    it('should calculate ETA when speed and progress are available', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue({
        id: 'job-1',
        stage: 'TRANSFERRING',
        transferRequired: true,
        transferProgress: 50,
        transferSpeedMBps: 10, // 10 MB/s
        transferError: null,
        beforeSizeBytes: BigInt(1048576000), // ~1000 MB
      });

      const result = await service.getTransferProgress('job-1');

      expect(result.eta).toBeGreaterThan(0);
    });

    it('should return null ETA when speed is not available', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue({
        id: 'job-1',
        stage: 'TRANSFERRING',
        transferRequired: true,
        transferProgress: 50,
        transferSpeedMBps: null,
        transferError: null,
        beforeSizeBytes: BigInt(1073741824),
      });

      const result = await service.getTransferProgress('job-1');

      expect(result.eta).toBeNull();
    });
  });

  // ==========================================================================
  // cancelTransfer
  // ==========================================================================
  describe('cancelTransfer', () => {
    it('should log warning when no active transfer found', async () => {
      // No active transfer registered for this job
      await service.cancelTransfer('no-such-job');

      expect(jobRepository.updateById).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // cleanupRemoteTempFile
  // ==========================================================================
  describe('cleanupRemoteTempFile', () => {
    it('should skip cleanup when job has no remoteTempPath', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue({
        remoteTempPath: null,
        node: { id: 'node-1', name: 'Child', ipAddress: '192.168.1.170' },
      });

      await service.cleanupRemoteTempFile('job-1');

      // No update or remote command should be called
      expect(jobRepository.updateById).not.toHaveBeenCalled();
    });

    it('should skip cleanup when job not found', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue(null);

      await service.cleanupRemoteTempFile('nonexistent');

      expect(jobRepository.updateById).not.toHaveBeenCalled();
    });

    it('should call remote rm command and update DB when remoteTempPath exists', async () => {
      const { spawn } = require('node:child_process');

      const mockStdout = { on: jest.fn(), destroy: jest.fn() };
      const mockStderr = { on: jest.fn(), destroy: jest.fn() };
      const mockSsh = {
        stdout: mockStdout,
        stderr: mockStderr,
        on: jest.fn(),
        kill: jest.fn(),
        killed: false,
      };

      spawn.mockReturnValue(mockSsh);

      jobRepository.findUniqueSelect.mockResolvedValue({
        remoteTempPath: '/tmp/bitbonsai-transfer/movie.mkv',
        node: { id: 'node-1', name: 'Child', ipAddress: '192.168.1.170' },
      });
      jobRepository.updateById.mockResolvedValue({});

      // Trigger close with code 0 to simulate success
      mockSsh.on.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setImmediate(() => cb(0));
        }
      });
      mockStdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from(''));
      });
      mockStderr.on.mockImplementation(() => {
        /* noop */
      });

      await service.cleanupRemoteTempFile('job-1');

      expect(jobRepository.updateById).toHaveBeenCalledWith('job-1', { remoteTempPath: null });
    });

    it('should handle remote command failure gracefully', async () => {
      const { spawn } = require('node:child_process');

      const mockStdout = { on: jest.fn(), destroy: jest.fn() };
      const mockStderr = { on: jest.fn(), destroy: jest.fn() };
      const mockSsh = {
        stdout: mockStdout,
        stderr: mockStderr,
        on: jest.fn(),
        kill: jest.fn(),
        killed: false,
      };

      spawn.mockReturnValue(mockSsh);

      jobRepository.findUniqueSelect.mockResolvedValue({
        remoteTempPath: '/tmp/bitbonsai-transfer/movie.mkv',
        node: { id: 'node-1', name: 'Child', ipAddress: '192.168.1.170' },
      });

      mockSsh.on.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setImmediate(() => cb(1)); // non-zero exit
        }
      });
      mockStdout.on.mockImplementation(() => {
        /* noop */
      });
      mockStderr.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from('rm: cannot remove'));
      });

      // Should not throw
      await service.cleanupRemoteTempFile('job-1');
      // updateById should NOT be called on failure
      expect(jobRepository.updateById).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // cancelTransfer - with active transfer
  // ==========================================================================
  describe('cancelTransfer with active transfer', () => {
    it('should abort and update job when active transfer exists', async () => {
      // Inject an active AbortController into the service's private map
      const abortController = new AbortController();
      const abortSpy = jest.spyOn(abortController, 'abort');
      (service as unknown as { activeTransfers: Map<string, AbortController> }).activeTransfers.set(
        'job-cancel',
        abortController
      );

      jobRepository.updateById.mockResolvedValue({});

      await service.cancelTransfer('job-cancel');

      expect(abortSpy).toHaveBeenCalled();
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-cancel',
        expect.objectContaining({
          stage: 'CANCELLED',
          transferError: 'Transfer cancelled by user',
        })
      );

      // Should be removed from map
      expect(
        (
          service as unknown as { activeTransfers: Map<string, AbortController> }
        ).activeTransfers.has('job-cancel')
      ).toBe(false);
    });
  });

  // ==========================================================================
  // getTransferProgress - ETA null when progress is 0
  // ==========================================================================
  describe('getTransferProgress - additional cases', () => {
    it('should return null ETA when progress is 0 even with speed', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue({
        id: 'job-1',
        stage: 'TRANSFERRING',
        transferRequired: true,
        transferProgress: 0,
        transferSpeedMBps: 50,
        transferError: null,
        beforeSizeBytes: BigInt(1073741824),
      });

      const result = await service.getTransferProgress('job-1');
      // ETA is null when progress === 0 (division by zero guard)
      expect(result.eta).toBeNull();
    });

    it('should return PENDING when not transferring and progress < 100 and no error', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue({
        id: 'job-2',
        stage: 'DETECTED',
        transferRequired: true,
        transferProgress: 25,
        transferSpeedMBps: null,
        transferError: null,
        beforeSizeBytes: BigInt(500000000),
      });

      const result = await service.getTransferProgress('job-2');
      expect(result.status).toBe('PENDING');
    });
  });

  // ==========================================================================
  // transferFile - error path: retry logic
  // ==========================================================================
  describe('transferFile - error retry logic', () => {
    const sourceNode = {
      id: 'src-1',
      name: 'Main',
      ipAddress: '192.168.1.100',
      hasSharedStorage: false,
    };
    const targetNode = {
      id: 'tgt-1',
      name: 'Child',
      ipAddress: '192.168.1.170',
      hasSharedStorage: false,
    };

    it('should mark FAILED after max retries reached', async () => {
      const { spawn } = require('node:child_process');

      const mockStdout = { on: jest.fn(), destroy: jest.fn() };
      const mockStderr = { on: jest.fn(), destroy: jest.fn() };
      const mockProcess = {
        stdout: mockStdout,
        stderr: mockStderr,
        on: jest.fn(),
        kill: jest.fn(),
        killed: false,
      };
      spawn.mockReturnValue(mockProcess);

      // All updateById calls succeed; findUniqueSelect returns retryCount = 2 (3rd attempt = max)
      jobRepository.updateById.mockResolvedValue({});
      jobRepository.findUniqueSelect.mockResolvedValue({ transferRetryCount: 2 });

      // Simulate SSH for mkdir command then rsync error
      let spawnCallCount = 0;
      spawn.mockImplementation(() => {
        spawnCallCount++;
        const proc = {
          stdout: { on: jest.fn(), destroy: jest.fn() },
          stderr: { on: jest.fn(), destroy: jest.fn() },
          on: jest.fn(),
          kill: jest.fn(),
          killed: false,
        };
        proc.on.mockImplementation((event: string, cb: (code: number | Error) => void) => {
          if (event === 'close') {
            setImmediate(() => cb(spawnCallCount === 1 ? 0 : 1)); // mkdir ok, rsync fail
          }
        });
        proc.stdout.on.mockImplementation(() => {
          /* noop */
        });
        proc.stderr.on.mockImplementation((evt: string, cb: (d: Buffer) => void) => {
          if (evt === 'data') cb(Buffer.from('connection refused'));
        });
        return proc;
      });

      await expect(
        service.transferFile(
          'job-max-retry',
          '/media/file.mkv',
          sourceNode as unknown as import('@prisma/client').Node,
          targetNode as unknown as import('@prisma/client').Node
        )
      ).rejects.toThrow();

      // Last updateById call should mark as FAILED
      const calls = jobRepository.updateById.mock.calls;
      const failCall = calls.find((c: unknown[]) => {
        const data = c[1] as { stage?: string };
        return data?.stage === 'FAILED';
      });
      expect(failCall).toBeDefined();
    });

    it('should reset to DETECTED stage when retries remain', async () => {
      const { spawn } = require('node:child_process');

      jobRepository.updateById.mockResolvedValue({});
      jobRepository.findUniqueSelect.mockResolvedValue({ transferRetryCount: 0 });

      let spawnCallCount = 0;
      spawn.mockImplementation(() => {
        spawnCallCount++;
        const proc = {
          stdout: { on: jest.fn(), destroy: jest.fn() },
          stderr: { on: jest.fn(), destroy: jest.fn() },
          on: jest.fn(),
          kill: jest.fn(),
          killed: false,
        };
        proc.on.mockImplementation((event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            setImmediate(() => cb(spawnCallCount === 1 ? 0 : 1));
          }
        });
        proc.stdout.on.mockImplementation(() => {
          /* noop */
        });
        proc.stderr.on.mockImplementation((evt: string, cb: (d: Buffer) => void) => {
          if (evt === 'data') cb(Buffer.from('rsync error'));
        });
        return proc;
      });

      await expect(
        service.transferFile(
          'job-retry',
          '/media/file.mkv',
          sourceNode as unknown as import('@prisma/client').Node,
          targetNode as unknown as import('@prisma/client').Node
        )
      ).rejects.toThrow();

      const calls = jobRepository.updateById.mock.calls;
      const detectedCall = calls.find((c: unknown[]) => {
        const data = c[1] as { stage?: string };
        return data?.stage === 'DETECTED';
      });
      expect(detectedCall).toBeDefined();
    });
  });

  // ==========================================================================
  // onModuleInit - error codes
  // ==========================================================================
  describe('onModuleInit - error code handling', () => {
    it('should warn when exec errors with code other than 1', async () => {
      const { exec } = require('node:child_process');
      exec.mockImplementation(
        (_cmd: string, cb: (err: { code: number }, stdout: string, stderr: string) => void) => {
          cb({ code: 2 }, '', 'permission denied');
        }
      );

      await service.onModuleInit();
      // Should complete without throwing
    });
  });
});
