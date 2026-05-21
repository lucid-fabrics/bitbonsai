import { Test, type TestingModule } from '@nestjs/testing';
import { ContainerValidationService } from '../../services/container-validation.service';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'node:child_process';
import { EventEmitter } from 'events';

describe('ContainerValidationService', () => {
  let service: ContainerValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContainerValidationService],
    }).compile();

    service = module.get<ContainerValidationService>(ContainerValidationService);

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

  describe('validateContainer', () => {
    it('should return valid: true for happy path', async () => {
      const probeOutput = {
        format: { duration: '120.0', nb_streams: 2 },
      };

      createMockProcess(0, JSON.stringify(probeOutput));

      const result = await service.validateContainer('/test/file.mkv');

      expect(result.valid).toBe(true);
    });

    it('should return valid: false when moov atom not found', async () => {
      const probeOutput = {
        format: { duration: '100', nb_streams: 1 },
      };

      createMockProcess(0, JSON.stringify(probeOutput), 'moov atom not found');

      const result = await service.validateContainer('/test/file.mp4');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Container error: moov atom not found');
    });

    it('should return valid: false for EBML error', async () => {
      const probeOutput = {
        format: { duration: '100', nb_streams: 1 },
      };

      createMockProcess(0, JSON.stringify(probeOutput), 'invalid as first byte of an EBML number');

      const result = await service.validateContainer('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Container error: invalid as first byte of an EBML number');
    });

    it('should return valid: false when ffprobe exits non-zero', async () => {
      createMockProcess(1, '', 'Error opening input');

      const result = await service.validateContainer('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('ffprobe exited 1');
    });

    it('should return valid: false when no streams found', async () => {
      const probeOutput = {
        format: { duration: '120', nb_streams: 0 },
      };

      createMockProcess(0, JSON.stringify(probeOutput));

      const result = await service.validateContainer('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('No streams found in output container');
    });

    it('should return valid: false when duration is zero', async () => {
      const probeOutput = {
        format: { duration: '0', nb_streams: 2 },
      };

      createMockProcess(0, JSON.stringify(probeOutput));

      const result = await service.validateContainer('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid duration: 0');
    });

    it('should return valid: true when ffprobe not installed (ENOENT) - fail open', async () => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout.destroy = jest.fn();
      proc.stderr.destroy = jest.fn();
      proc.kill = jest.fn();

      (spawn as jest.Mock).mockReturnValue(proc);

      setTimeout(() => {
        proc.emit('error', {
          code: 'ENOENT',
          message: 'ffprobe not found',
        } as NodeJS.ErrnoException);
      }, 10);

      const result = await service.validateContainer('/test/file.mkv');

      expect(result.valid).toBe(true);
    });

    it('should return valid: true on timeout - fail open', async () => {
      jest.useFakeTimers();
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout.destroy = jest.fn();
      proc.stderr.destroy = jest.fn();
      proc.kill = jest.fn();

      (spawn as jest.Mock).mockReturnValue(proc);

      const resultPromise = service.validateContainer('/test/file.mkv');
      jest.advanceTimersByTime(31_000);
      const result = await resultPromise;

      expect(result.valid).toBe(true);
      jest.useRealTimers();
    });

    it('should return valid: false when duration mismatch exceeds 10% tolerance and is below 50% of expected', async () => {
      const probeOutput = {
        format: { duration: '30.0', nb_streams: 2 },
      };

      createMockProcess(0, JSON.stringify(probeOutput));

      const result = await service.validateContainer('/test/file.mkv', 120);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Duration mismatch');
    });

    it('should return valid: true when duration mismatch is within 10% tolerance', async () => {
      const probeOutput = {
        format: { duration: '118.0', nb_streams: 2 },
      };

      createMockProcess(0, JSON.stringify(probeOutput));

      const result = await service.validateContainer('/test/file.mkv', 120);

      expect(result.valid).toBe(true);
    });

    it('should return valid: true when duration is within tolerance of expected', async () => {
      const probeOutput = {
        format: { duration: '119.0', nb_streams: 2 },
      };

      createMockProcess(0, JSON.stringify(probeOutput));

      const result = await service.validateContainer('/test/file.mkv', 120);

      // diff=1, tolerance=Math.max(0.5, Math.min(2, 120*0.1))=2 → passes (1 < 2)
      // 119 > 120*0.5=60 so 50% check passes too
      expect(result.valid).toBe(true);
    });

    it('should return valid: false when no format section returned', async () => {
      createMockProcess(0, JSON.stringify({}));

      const result = await service.validateContainer('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('ffprobe returned no format section');
    });

    it('should return valid: false when JSON parse fails', async () => {
      createMockProcess(0, 'not valid json');

      const result = await service.validateContainer('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('ffprobe JSON parse failed');
    });

    it('should detect "Length indicated by EBML number" error', async () => {
      const probeOutput = {
        format: { duration: '100', nb_streams: 1 },
      };

      createMockProcess(0, JSON.stringify(probeOutput), 'Length indicated by EBML number');

      const result = await service.validateContainer('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Container error');
    });

    it('should detect "no decoder for codec" error', async () => {
      const probeOutput = {
        format: { duration: '100', nb_streams: 1 },
      };

      createMockProcess(0, JSON.stringify(probeOutput), 'no decoder for codec');

      const result = await service.validateContainer('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Container error');
    });

    it('should detect "Invalid data found" error', async () => {
      const probeOutput = {
        format: { duration: '100', nb_streams: 1 },
      };

      createMockProcess(0, JSON.stringify(probeOutput), 'Invalid data found');

      const result = await service.validateContainer('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Container error');
    });
  });

  describe('decodeWalk', () => {
    it('should return valid: true for happy path', async () => {
      createMockProcess(0, '', '');

      const result = await service.decodeWalk('/test/file.mkv');

      expect(result.valid).toBe(true);
    });

    it('should return valid: false when stderr contains "corrupt"', async () => {
      createMockProcess(1, '', 'corrupt data found in mdat atom');

      const result = await service.decodeWalk('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Decode walk errors');
    });

    it('should return valid: false when stderr contains "truncat"', async () => {
      createMockProcess(0, '', 'file appears to be truncated');

      const result = await service.decodeWalk('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Decode walk errors');
    });

    it('should return valid: true on timeout - fail open', async () => {
      jest.useFakeTimers();
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout.destroy = jest.fn();
      proc.stderr.destroy = jest.fn();
      proc.kill = jest.fn();

      (spawn as jest.Mock).mockReturnValue(proc);

      const resultPromise = service.decodeWalk('/test/file.mkv');
      jest.advanceTimersByTime(121_000);
      const result = await resultPromise;

      expect(result.valid).toBe(true);
      jest.useRealTimers();
    });

    it('should return valid: true when ffprobe not found (spawn error) - fail open', async () => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout.destroy = jest.fn();
      proc.stderr.destroy = jest.fn();
      proc.kill = jest.fn();

      (spawn as jest.Mock).mockReturnValue(proc);

      setTimeout(() => {
        proc.emit('error', {
          code: 'ENOENT',
          message: 'ffmpeg not found',
        } as NodeJS.ErrnoException);
      }, 10);

      const result = await service.decodeWalk('/test/file.mkv');

      expect(result.valid).toBe(true);
    });

    it('should return valid: false when non-zero exit code without error patterns', async () => {
      createMockProcess(2, '', 'some other error message');

      const result = await service.decodeWalk('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Decode walk errors');
    });

    it('should limit error lines to first 3', async () => {
      createMockProcess(1, '', 'error 1\nerror 2\nerror 3\nerror 4\nerror 5\nerror 6');

      const result = await service.decodeWalk('/test/file.mkv');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('error 1');
      expect(result.reason).toContain('error 2');
      expect(result.reason).toContain('error 3');
      expect(result.reason).not.toContain('error 4');
    });

    it('should detect "invalid" pattern in stderr', async () => {
      createMockProcess(0, '', 'invalid frame data');

      const result = await service.decodeWalk('/test/file.mkv');

      expect(result.valid).toBe(false);
    });

    it('should detect "error" pattern case-insensitively', async () => {
      createMockProcess(0, '', 'ERROR: critical issue');

      const result = await service.decodeWalk('/test/file.mkv');

      expect(result.valid).toBe(false);
    });
  });
});
