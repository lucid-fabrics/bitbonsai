import { EventEmitter } from 'node:events';
import { Test, type TestingModule } from '@nestjs/testing';
import { GpuHealthService } from '../../gpu-health.service';

// ---------------------------------------------------------------------------
// child_process mock
// ---------------------------------------------------------------------------

const mockSpawn = jest.fn();

jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// ---------------------------------------------------------------------------
// fs/promises mock (VAAPI device access check)
// ---------------------------------------------------------------------------

const mockAccess = jest.fn();

jest.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}));

// ---------------------------------------------------------------------------
// Fake process builder
//
// Returns an EventEmitter-based fake that mimics the subset of ChildProcess
// used by GpuHealthService: stdout/stderr data events, error event, close event.
// ---------------------------------------------------------------------------

interface FakeProcessOptions {
  stdoutData?: string;
  stderrData?: string;
  exitCode?: number | null;
  errorCode?: string; // triggers 'error' event instead of 'close'
  /** If true, neither 'error' nor 'close' is emitted — simulates a hang */
  hang?: boolean;
}

function makeFakeProcess(opts: FakeProcessOptions = {}) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
  };

  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();

  if (!opts.hang) {
    setImmediate(() => {
      if (opts.stdoutData) proc.stdout.emit('data', Buffer.from(opts.stdoutData));
      if (opts.stderrData) proc.stderr.emit('data', Buffer.from(opts.stderrData));

      if (opts.errorCode !== undefined) {
        const err = Object.assign(new Error(opts.errorCode), { code: opts.errorCode });
        proc.emit('error', err);
      } else {
        proc.emit('close', opts.exitCode ?? 0);
      }
    });
  }

  return proc;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('GpuHealthService', () => {
  let service: GpuHealthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useRealTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [GpuHealthService],
    }).compile();

    service = module.get<GpuHealthService>(GpuHealthService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==========================================================================
  // recordGpuFailure
  // ==========================================================================
  describe('recordGpuFailure', () => {
    it('activates cooldown so next isGpuHealthy call returns false', async () => {
      service.recordGpuFailure('driver crash');

      const healthy = await service.isGpuHealthy();

      expect(healthy).toBe(false);
    });

    it('cooldown expires and GPU check proceeds normally', async () => {
      // Record failure at real time, then make Date.now return a future time
      // so the cooldown window appears expired.
      service.recordGpuFailure('flap');
      const futureNow = Date.now() + 61_000;
      jest.spyOn(Date, 'now').mockReturnValue(futureNow);

      // Both probes return not_found → CPU-only → healthy
      mockSpawn
        .mockReturnValueOnce(makeFakeProcess({ errorCode: 'ENOENT' })) // nvidia-smi
        .mockReturnValueOnce(makeFakeProcess({ errorCode: 'ENOENT' })); // vainfo
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await service.isGpuHealthy();

      jest.spyOn(Date, 'now').mockRestore();
      expect(result).toBe(true);
    });
  });

  // ==========================================================================
  // isGpuHealthy — nvidia-smi path
  // ==========================================================================
  describe('isGpuHealthy — nvidia-smi', () => {
    it('returns true when nvidia-smi succeeds with pstate output', async () => {
      mockSpawn.mockReturnValueOnce(makeFakeProcess({ stdoutData: 'P0\n' }));

      const result = await service.isGpuHealthy();

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'nvidia-smi',
        expect.arrayContaining(['--query-gpu=pstate']),
        expect.any(Object)
      );
    });

    it('returns false when nvidia-smi exits non-zero', async () => {
      mockSpawn.mockReturnValueOnce(makeFakeProcess({ exitCode: 1 }));

      const result = await service.isGpuHealthy();

      expect(result).toBe(false);
    });

    it('returns false when nvidia-smi exits 0 but stdout is empty', async () => {
      mockSpawn.mockReturnValueOnce(makeFakeProcess({ stdoutData: '' }));

      const result = await service.isGpuHealthy();

      expect(result).toBe(false);
    });

    it('returns false when nvidia-smi emits a non-ENOENT error', async () => {
      mockSpawn.mockReturnValueOnce(makeFakeProcess({ errorCode: 'EACCES' }));

      const result = await service.isGpuHealthy();

      expect(result).toBe(false);
    });

    it('falls through to vainfo when nvidia-smi ENOENT (not installed)', async () => {
      // nvidia-smi → ENOENT (not_found); vainfo → ENOENT (not_found); no VAAPI device
      mockSpawn
        .mockReturnValueOnce(makeFakeProcess({ errorCode: 'ENOENT' })) // nvidia-smi
        .mockReturnValueOnce(makeFakeProcess({ errorCode: 'ENOENT' })); // vainfo
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await service.isGpuHealthy();

      // CPU-only node → healthy
      expect(result).toBe(true);
    });
  });

  // ==========================================================================
  // isGpuHealthy — nvidia-smi timeout
  // ==========================================================================
  describe('isGpuHealthy — nvidia-smi timeout', () => {
    it('returns unhealthy and kills process on timeout', async () => {
      jest.useFakeTimers();

      const fakeProc = makeFakeProcess({ hang: true });
      mockSpawn.mockReturnValueOnce(fakeProc);

      const promise = service.isGpuHealthy();

      // Advance past the 5-second nvidia-smi timeout
      jest.advanceTimersByTime(5_001);

      const result = await promise;

      expect(result).toBe(false);
      expect(fakeProc.kill).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // isGpuHealthy — vainfo path (nvidia-smi not found)
  // ==========================================================================
  describe('isGpuHealthy — vainfo', () => {
    beforeEach(() => {
      // Always short-circuit nvidia-smi as not_found
      mockSpawn.mockReturnValueOnce(makeFakeProcess({ errorCode: 'ENOENT' }));
    });

    it('returns true when vainfo reports VAEntrypointEncSlice', async () => {
      mockSpawn.mockReturnValueOnce(
        makeFakeProcess({ stdoutData: 'VAEntrypointEncSlice found\n' })
      );

      const result = await service.isGpuHealthy();

      expect(result).toBe(true);
    });

    it('returns true when vainfo reports VAEntrypointEncSliceLP', async () => {
      mockSpawn.mockReturnValueOnce(
        makeFakeProcess({ stdoutData: 'VAEntrypointEncSliceLP found\n' })
      );

      const result = await service.isGpuHealthy();

      expect(result).toBe(true);
    });

    it('returns false when vainfo exits 0 but no encode entrypoint in output', async () => {
      mockSpawn.mockReturnValueOnce(makeFakeProcess({ stdoutData: 'VAEntrypointVLD only\n' }));

      const result = await service.isGpuHealthy();

      expect(result).toBe(false);
    });

    it('returns false when vainfo exits non-zero', async () => {
      mockSpawn.mockReturnValueOnce(makeFakeProcess({ exitCode: 1 }));

      const result = await service.isGpuHealthy();

      expect(result).toBe(false);
    });

    it('falls through to VAAPI device check when vainfo ENOENT', async () => {
      mockSpawn.mockReturnValueOnce(makeFakeProcess({ errorCode: 'ENOENT' }));
      mockAccess.mockResolvedValue(undefined); // device node exists

      const result = await service.isGpuHealthy();

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith('/dev/dri/renderD128');
    });

    it('returns true (CPU-only) when vainfo ENOENT and VAAPI device absent', async () => {
      mockSpawn.mockReturnValueOnce(makeFakeProcess({ errorCode: 'ENOENT' }));
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await service.isGpuHealthy();

      expect(result).toBe(true);
    });

    it('returns false when vainfo emits a non-ENOENT error', async () => {
      mockSpawn.mockReturnValueOnce(makeFakeProcess({ errorCode: 'EACCES' }));

      const result = await service.isGpuHealthy();

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // isGpuHealthy — vainfo timeout
  // ==========================================================================
  describe('isGpuHealthy — vainfo timeout', () => {
    it('resolves unhealthy and kills process on timeout', async () => {
      jest.useFakeTimers();

      // nvidia-smi: emits synchronously so probe resolves before vainfo is spawned
      const nvidiaSmiProc = makeFakeProcess({ hang: true });
      // We'll resolve nvidia-smi as ENOENT by triggering its error event directly
      mockSpawn.mockReturnValueOnce(nvidiaSmiProc);

      // vainfo: hangs (no close/error ever emitted)
      const vainfoProc = makeFakeProcess({ hang: true });
      mockSpawn.mockReturnValueOnce(vainfoProc);

      const promise = service.isGpuHealthy();

      // Trigger nvidia-smi ENOENT error synchronously to unblock vainfo spawn
      nvidiaSmiProc.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      // Let the nvidia-smi Promise resolve before advancing timers
      await Promise.resolve();

      // Advance past the 5-second vainfo timeout
      jest.advanceTimersByTime(5_001);

      const result = await promise;

      expect(result).toBe(false);
      expect(vainfoProc.kill).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // isGpuHealthy — cooldown gate (no spawn calls needed)
  // ==========================================================================
  describe('isGpuHealthy — active cooldown', () => {
    it('returns false immediately without spawning any process', async () => {
      service.recordGpuFailure('test');

      const result = await service.isGpuHealthy();

      expect(result).toBe(false);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });
});
