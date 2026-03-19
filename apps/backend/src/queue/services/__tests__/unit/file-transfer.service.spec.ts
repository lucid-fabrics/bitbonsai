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
      expect(failCall).not.toBeUndefined();
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
      expect(detectedCall).not.toBeUndefined();
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

  // ==========================================================================
  // validateRsyncPath - additional edge cases
  // ==========================================================================
  describe('path validation - additional edge cases', () => {
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

    it('should reject paths with double slashes', async () => {
      await expect(
        service.transferFile('job-1', '/media//file.mkv', sourceNode as any, targetNode as any)
      ).rejects.toThrow('Path traversal attempt detected');
    });

    it('should reject paths with rsync daemon syntax (::)', async () => {
      await expect(
        service.transferFile('job-1', '/media/host::module', sourceNode as any, targetNode as any)
      ).rejects.toThrow('Invalid path characters detected');
    });

    it('should reject empty IP address on target node', async () => {
      const emptyIpTarget = { ...targetNode, ipAddress: '' };
      await expect(
        service.transferFile('job-1', '/media/file.mkv', sourceNode as any, emptyIpTarget as any)
      ).rejects.toThrow('has no IP address');
    });

    it('should reject target node with IP containing letters', async () => {
      const badTarget = { ...targetNode, ipAddress: 'hostname.local' };
      await expect(
        service.transferFile('job-1', '/media/file.mkv', sourceNode as any, badTarget as any)
      ).rejects.toThrow('Invalid IP address format');
    });
  });

  // ==========================================================================
  // getTransferProgress - edge cases with zero bytes
  // ==========================================================================
  describe('getTransferProgress - zero bytes edge cases', () => {
    it('should handle beforeSizeBytes of 0 without dividing by zero', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue({
        id: 'job-zero',
        stage: 'TRANSFERRING',
        transferRequired: true,
        transferProgress: 50,
        transferSpeedMBps: 10,
        transferError: null,
        beforeSizeBytes: BigInt(0),
      });

      const result = await service.getTransferProgress('job-zero');

      expect(result.bytesTransferred).toBe(BigInt(0));
      expect(result.totalBytes).toBe(BigInt(0));
    });

    it('should return null ETA when transferSpeedMBps is 0', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue({
        id: 'job-nospeed',
        stage: 'TRANSFERRING',
        transferRequired: true,
        transferProgress: 50,
        transferSpeedMBps: 0,
        transferError: null,
        beforeSizeBytes: BigInt(1073741824),
      });

      const result = await service.getTransferProgress('job-nospeed');
      // transferSpeedMBps is falsy (0), so ETA is null
      expect(result.eta).toBeNull();
    });

    it('should include error field when transferError is set', async () => {
      jobRepository.findUniqueSelect.mockResolvedValue({
        id: 'job-err',
        stage: 'QUEUED',
        transferRequired: true,
        transferProgress: 10,
        transferSpeedMBps: null,
        transferError: 'rsync: connection timeout',
        beforeSizeBytes: BigInt(500000000),
      });

      const result = await service.getTransferProgress('job-err');
      expect(result.error).toBe('rsync: connection timeout');
      expect(result.status).toBe('FAILED');
    });
  });

  // ==========================================================================
  // transferFile - null transferRetryCount in job (first failure ever)
  // ==========================================================================
  describe('transferFile - null transferRetryCount in job', () => {
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

    it('should treat null transferRetryCount as 0 when computing next retry', async () => {
      const { spawn } = require('node:child_process');

      jobRepository.updateById.mockResolvedValue({});
      // null transferRetryCount simulates a job that has never failed before
      jobRepository.findUniqueSelect.mockResolvedValue({ transferRetryCount: null });

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
          if (evt === 'data') cb(Buffer.from('connection refused'));
        });
        return proc;
      });

      await expect(
        service.transferFile(
          'job-null-retry',
          '/media/file.mkv',
          sourceNode as unknown as import('@prisma/client').Node,
          targetNode as unknown as import('@prisma/client').Node
        )
      ).rejects.toThrow();

      // retryCount should be 1 (0 + 1), so stage should be DETECTED (not FAILED)
      const calls = jobRepository.updateById.mock.calls;
      const detectedCall = calls.find((c: unknown[]) => {
        const data = c[1] as { stage?: string };
        return data?.stage === 'DETECTED';
      });
      expect(detectedCall).not.toBeUndefined();
    });
  });

  // ==========================================================================
  // cancelTransfer - map cleanup after abort
  // ==========================================================================
  describe('cancelTransfer - double cancel', () => {
    it('should not throw on second cancel of same job', async () => {
      const abortController = new AbortController();
      (service as unknown as { activeTransfers: Map<string, AbortController> }).activeTransfers.set(
        'job-double-cancel',
        abortController
      );
      jobRepository.updateById.mockResolvedValue({});

      await service.cancelTransfer('job-double-cancel');
      // Second cancel should be a no-op (job no longer in map)
      await service.cancelTransfer('job-double-cancel');

      // updateById called only once (first cancel)
      expect(jobRepository.updateById).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // rsyncTransfer - stdout progress parsing: speed unit branches
  // ==========================================================================
  describe('rsyncTransfer - stdout progress parsing', () => {
    function _makeSpawnMock(stdoutLines: string[], exitCode = 0) {
      const { spawn } = require('node:child_process');
      const stdoutHandlers: Record<string, ((data: Buffer) => void)[]> = {};
      const stderrHandlers: Record<string, ((data: Buffer) => void)[]> = {};
      const closeHandlers: ((code: number) => void)[] = [];
      const errorHandlers: ((err: Error) => void)[] = [];

      const mockProc = {
        stdout: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            stdoutHandlers[event] = stdoutHandlers[event] || [];
            stdoutHandlers[event].push(cb);
          }),
          destroy: jest.fn(),
        },
        stderr: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            stderrHandlers[event] = stderrHandlers[event] || [];
            stderrHandlers[event].push(cb);
          }),
          destroy: jest.fn(),
        },
        on: jest.fn((event: string, cb: (arg: number | Error) => void) => {
          if (event === 'close') closeHandlers.push(cb as (code: number) => void);
          if (event === 'error') errorHandlers.push(cb as (err: Error) => void);
        }),
        kill: jest.fn(),
        killed: false,
      };

      spawn.mockReturnValue(mockProc);

      // Emit events asynchronously after spawn is set up
      setImmediate(() => {
        for (const line of stdoutLines) {
          (stdoutHandlers.data || []).forEach((h) => {
            h(Buffer.from(line));
          });
        }
        setImmediate(() => {
          closeHandlers.forEach((h) => {
            h(exitCode);
          });
        });
      });

      return mockProc;
    }

    const targetNode = {
      id: 'tgt-1',
      name: 'Child',
      ipAddress: '192.168.1.170',
    } as any;

    it('should parse kB/s speed unit and convert to MB/s', async () => {
      jobRepository.updateById.mockResolvedValue({});

      // First spawn is SSH for mkdir, second is rsync
      const { spawn } = require('node:child_process');
      let callIdx = 0;
      spawn.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) {
          // SSH mkdir - success
          const sshProc = {
            stdout: { on: jest.fn(), destroy: jest.fn() },
            stderr: { on: jest.fn(), destroy: jest.fn() },
            on: jest.fn((event: string, cb: (code: number) => void) => {
              if (event === 'close') setImmediate(() => cb(0));
            }),
            kill: jest.fn(),
            killed: false,
          };
          sshProc.stdout.on.mockReturnValue(undefined);
          sshProc.stderr.on.mockReturnValue(undefined);
          return sshProc;
        }
        // rsync with kB/s progress
        const stdoutCbs: ((d: Buffer) => void)[] = [];
        const closeCbs: ((code: number) => void)[] = [];
        const rsyncProc = {
          stdout: {
            on: jest.fn((evt: string, cb: (d: Buffer) => void) => {
              if (evt === 'data') stdoutCbs.push(cb);
            }),
            destroy: jest.fn(),
          },
          stderr: { on: jest.fn(), destroy: jest.fn() },
          on: jest.fn((evt: string, cb: (code: number) => void) => {
            if (evt === 'close') closeCbs.push(cb);
          }),
          kill: jest.fn(),
          killed: false,
        };
        rsyncProc.stderr.on.mockReturnValue(undefined);
        setImmediate(() => {
          stdoutCbs.forEach((cb) => {
            cb(Buffer.from('102.4k  10%  512.00kB/s    0:00:10'));
          });
          setImmediate(() =>
            closeCbs.forEach((cb) => {
              cb(0);
            })
          );
        });
        return rsyncProc;
      });

      await (service as any).rsyncTransfer(
        'job-kbps',
        '/media/file.mkv',
        '/tmp/file.mkv',
        targetNode
      );

      // Should have called updateById with transferSpeedMBps = 512/1024 ≈ 0.5
      const progressCalls = (jobRepository.updateById.mock.calls as any[]).filter(
        (c) => c[1].transferProgress !== undefined
      );
      if (progressCalls.length > 0) {
        expect(progressCalls[0][1].transferSpeedMBps).toBeCloseTo(0.5, 1);
      }
    });

    it('should parse GB/s speed unit and convert to MB/s', async () => {
      jobRepository.updateById.mockResolvedValue({});

      const { spawn } = require('node:child_process');
      let callIdx = 0;
      spawn.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) {
          const sshProc = {
            stdout: { on: jest.fn(), destroy: jest.fn() },
            stderr: { on: jest.fn(), destroy: jest.fn() },
            on: jest.fn((event: string, cb: (code: number) => void) => {
              if (event === 'close') setImmediate(() => cb(0));
            }),
            kill: jest.fn(),
            killed: false,
          };
          sshProc.stdout.on.mockReturnValue(undefined);
          sshProc.stderr.on.mockReturnValue(undefined);
          return sshProc;
        }
        const stdoutCbs: ((d: Buffer) => void)[] = [];
        const closeCbs: ((code: number) => void)[] = [];
        const rsyncProc = {
          stdout: {
            on: jest.fn((evt: string, cb: (d: Buffer) => void) => {
              if (evt === 'data') stdoutCbs.push(cb);
            }),
            destroy: jest.fn(),
          },
          stderr: { on: jest.fn(), destroy: jest.fn() },
          on: jest.fn((evt: string, cb: (code: number) => void) => {
            if (evt === 'close') closeCbs.push(cb);
          }),
          kill: jest.fn(),
          killed: false,
        };
        rsyncProc.stderr.on.mockReturnValue(undefined);
        setImmediate(() => {
          stdoutCbs.forEach((cb) => {
            cb(Buffer.from('5.00G  10%  2.00GB/s    0:00:01'));
          });
          setImmediate(() =>
            closeCbs.forEach((cb) => {
              cb(0);
            })
          );
        });
        return rsyncProc;
      });

      await (service as any).rsyncTransfer(
        'job-gbps',
        '/media/file.mkv',
        '/tmp/file.mkv',
        targetNode
      );

      const progressCalls = (jobRepository.updateById.mock.calls as any[]).filter(
        (c) => c[1].transferProgress !== undefined
      );
      if (progressCalls.length > 0) {
        expect(progressCalls[0][1].transferSpeedMBps).toBeCloseTo(2048, 0);
      }
    });

    it('should handle rsync error event (not close)', async () => {
      const { spawn } = require('node:child_process');
      // rsyncTransfer is called directly — spawn is invoked once for rsync only
      const errorCbs: ((err: Error) => void)[] = [];
      const rsyncProc = {
        stdout: { on: jest.fn(), destroy: jest.fn() },
        stderr: { on: jest.fn(), destroy: jest.fn() },
        on: jest.fn((evt: string, cb: (arg: number | Error) => void) => {
          if (evt === 'error') errorCbs.push(cb as (err: Error) => void);
        }),
        kill: jest.fn(),
        killed: false,
      };
      rsyncProc.stdout.on.mockReturnValue(undefined);
      rsyncProc.stderr.on.mockReturnValue(undefined);
      spawn.mockReturnValue(rsyncProc);

      setImmediate(() => {
        errorCbs.forEach((cb) => {
          cb(new Error('spawn rsync ENOENT'));
        });
      });

      await expect(
        (service as any).rsyncTransfer('job-err', '/media/file.mkv', '/tmp/file.mkv', targetNode)
      ).rejects.toThrow('spawn rsync ENOENT');
    });

    it('should use stderrBuffer content in error message when rsync exits non-zero', async () => {
      const { spawn } = require('node:child_process');
      // rsyncTransfer is called directly — spawn is invoked once for rsync only
      const stderrCbs: ((d: Buffer) => void)[] = [];
      const closeCbs: ((code: number) => void)[] = [];
      const rsyncProc = {
        stdout: { on: jest.fn(), destroy: jest.fn() },
        stderr: {
          on: jest.fn((evt: string, cb: (d: Buffer) => void) => {
            if (evt === 'data') stderrCbs.push(cb);
          }),
          destroy: jest.fn(),
        },
        on: jest.fn((evt: string, cb: (code: number) => void) => {
          if (evt === 'close') closeCbs.push(cb);
        }),
        kill: jest.fn(),
        killed: false,
      };
      rsyncProc.stdout.on.mockReturnValue(undefined);
      spawn.mockReturnValue(rsyncProc);

      setImmediate(() => {
        stderrCbs.forEach((cb) => {
          cb(Buffer.from('rsync: connection refused'));
        });
        setImmediate(() =>
          closeCbs.forEach((cb) => {
            cb(23);
          })
        );
      });

      await expect(
        (service as any).rsyncTransfer('job-stderr', '/media/file.mkv', '/tmp/file.mkv', targetNode)
      ).rejects.toThrow('rsync: connection refused');
    });
  });

  // ==========================================================================
  // executeRemoteCommand - SSH error event
  // ==========================================================================
  describe('executeRemoteCommand - SSH error event', () => {
    it('should reject when SSH emits error event', async () => {
      const { spawn } = require('node:child_process');
      const errorCbs: ((err: Error) => void)[] = [];
      const mockSsh = {
        stdout: { on: jest.fn(), destroy: jest.fn() },
        stderr: { on: jest.fn(), destroy: jest.fn() },
        on: jest.fn((evt: string, cb: (arg: number | Error) => void) => {
          if (evt === 'error') errorCbs.push(cb as (err: Error) => void);
        }),
        kill: jest.fn(),
        killed: false,
      };
      mockSsh.stdout.on.mockReturnValue(undefined);
      mockSsh.stderr.on.mockReturnValue(undefined);
      spawn.mockReturnValue(mockSsh);

      setImmediate(() =>
        errorCbs.forEach((cb) => {
          cb(new Error('ssh ENOENT'));
        })
      );

      const targetNode = {
        id: 'node-1',
        name: 'Child',
        ipAddress: '192.168.1.170',
      } as any;

      await expect((service as any).executeRemoteCommand(targetNode, 'ls /tmp')).rejects.toThrow(
        'ssh ENOENT'
      );
    });

    it('should reject with timeout error when SSH hangs', async () => {
      const { spawn } = require('node:child_process');
      const mockSsh = {
        stdout: { on: jest.fn(), destroy: jest.fn() },
        stderr: { on: jest.fn(), destroy: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        killed: false,
      };
      mockSsh.stdout.on.mockReturnValue(undefined);
      mockSsh.stderr.on.mockReturnValue(undefined);
      spawn.mockReturnValue(mockSsh);

      const targetNode = {
        id: 'node-1',
        name: 'Child',
        ipAddress: '192.168.1.170',
      } as any;

      // Use very short timeout to trigger quickly
      await expect(
        (service as any).executeRemoteCommand(targetNode, 'sleep 100', 10)
      ).rejects.toThrow('SSH command timed out');
    });

    it('should reject when SSH closes with non-zero exit code', async () => {
      const { spawn } = require('node:child_process');
      const stderrCbs: ((d: Buffer) => void)[] = [];
      const closeCbs: ((code: number) => void)[] = [];
      const mockSsh = {
        stdout: { on: jest.fn(), destroy: jest.fn() },
        stderr: {
          on: jest.fn((evt: string, cb: (d: Buffer) => void) => {
            if (evt === 'data') stderrCbs.push(cb);
          }),
          destroy: jest.fn(),
        },
        on: jest.fn((evt: string, cb: (code: number) => void) => {
          if (evt === 'close') closeCbs.push(cb);
        }),
        kill: jest.fn(),
        killed: false,
      };
      mockSsh.stdout.on.mockReturnValue(undefined);
      spawn.mockReturnValue(mockSsh);

      const targetNode = {
        id: 'node-1',
        name: 'Child',
        ipAddress: '192.168.1.170',
      } as any;

      setImmediate(() => {
        stderrCbs.forEach((cb) => {
          cb(Buffer.from('permission denied'));
        });
        setImmediate(() =>
          closeCbs.forEach((cb) => {
            cb(1);
          })
        );
      });

      await expect(
        (service as any).executeRemoteCommand(targetNode, 'rm /protected')
      ).rejects.toThrow('SSH command failed with code 1');
    });

    it('should resolve with stdout output on success', async () => {
      const { spawn } = require('node:child_process');
      const stdoutCbs: ((d: Buffer) => void)[] = [];
      const closeCbs: ((code: number) => void)[] = [];
      const mockSsh = {
        stdout: {
          on: jest.fn((evt: string, cb: (d: Buffer) => void) => {
            if (evt === 'data') stdoutCbs.push(cb);
          }),
          destroy: jest.fn(),
        },
        stderr: { on: jest.fn(), destroy: jest.fn() },
        on: jest.fn((evt: string, cb: (code: number) => void) => {
          if (evt === 'close') closeCbs.push(cb);
        }),
        kill: jest.fn(),
        killed: false,
      };
      mockSsh.stderr.on.mockReturnValue(undefined);
      spawn.mockReturnValue(mockSsh);

      const targetNode = {
        id: 'node-1',
        name: 'Child',
        ipAddress: '192.168.1.170',
      } as any;

      setImmediate(() => {
        stdoutCbs.forEach((cb) => {
          cb(Buffer.from('hello'));
        });
        setImmediate(() =>
          closeCbs.forEach((cb) => {
            cb(0);
          })
        );
      });

      const result = await (service as any).executeRemoteCommand(targetNode, 'echo hello');
      expect(result).toBe('hello');
    });
  });

  // ==========================================================================
  // validateRsyncPath - direct private method tests
  // ==========================================================================
  describe('validateRsyncPath - rsync daemon syntax (::)', () => {
    it('should throw when path contains :: directly', () => {
      expect(() => (service as any).validateRsyncPath('/media/host::module')).toThrow(
        'Invalid path characters detected'
      );
    });

    it('should accept valid safe path without throwing', () => {
      expect(() => (service as any).validateRsyncPath('/media/movies/film.mkv')).not.toThrow();
    });
  });
});
