import { EventEmitter } from 'node:events';
import { Test, type TestingModule } from '@nestjs/testing';
import { FfprobeService } from '../../ffprobe.service';

// ---------------------------------------------------------------------------
// Helpers: build lightweight fake child-process objects
// ---------------------------------------------------------------------------

function makeFakeProc(opts: {
  stdoutData?: string;
  stderrData?: string;
  closeCode?: number | null;
  errorEvent?: Error;
  delay?: number;
}) {
  const stdout = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
  const stderr = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
  stdout.destroy = jest.fn();
  stderr.destroy = jest.fn();

  const proc = new EventEmitter() as EventEmitter & {
    stdout: typeof stdout;
    stderr: typeof stderr;
    kill: jest.Mock;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.kill = jest.fn();

  const delay = opts.delay ?? 0;

  setImmediate(() => {
    setTimeout(() => {
      if (opts.errorEvent) {
        proc.emit('error', opts.errorEvent);
        return;
      }
      if (opts.stdoutData !== undefined) {
        stdout.emit('data', Buffer.from(opts.stdoutData));
      }
      if (opts.stderrData !== undefined) {
        stderr.emit('data', Buffer.from(opts.stderrData));
      }
      proc.emit('close', opts.closeCode ?? 0);
    }, delay);
  });

  return proc;
}

// ---------------------------------------------------------------------------
// Mock child_process.spawn
// ---------------------------------------------------------------------------

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'node:child_process';

const spawnMock = spawn as jest.Mock;

describe('FfprobeService', () => {
  let service: FfprobeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FfprobeService],
    }).compile();

    service = module.get<FfprobeService>(FfprobeService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // getVideoDuration
  // ---------------------------------------------------------------------------

  describe('getVideoDuration', () => {
    it('should return stream duration when ffprobe succeeds with valid output', async () => {
      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: '120.5\n', closeCode: 0 }));

      const result = await service.getVideoDuration('/video.mkv');

      expect(result).toBeCloseTo(120.5);
    });

    it('should fall back to format duration when stream output is empty', async () => {
      // First spawn: stream duration returns empty
      // Second spawn: format duration returns valid value
      spawnMock
        .mockReturnValueOnce(makeFakeProc({ stdoutData: '', closeCode: 0 }))
        .mockReturnValueOnce(makeFakeProc({ stdoutData: '200.0\n', closeCode: 0 }));

      const result = await service.getVideoDuration('/video.mkv');

      expect(result).toBeCloseTo(200.0);
    });

    it('should fall back to format duration when stream ffprobe exits with non-zero code', async () => {
      spawnMock
        .mockReturnValueOnce(makeFakeProc({ stdoutData: '', closeCode: 1 }))
        .mockReturnValueOnce(makeFakeProc({ stdoutData: '300.0\n', closeCode: 0 }));

      const result = await service.getVideoDuration('/video.mkv');

      expect(result).toBeCloseTo(300.0);
    });

    it('should return 3600 on ffprobe error event', async () => {
      spawnMock.mockReturnValue(makeFakeProc({ errorEvent: new Error('spawn ENOENT') }));

      const result = await service.getVideoDuration('/video.mkv');

      expect(result).toBe(3600);
    });

    it('should return 3600 when stream output is NaN', async () => {
      // Stream output is not a number → falls through to format fallback
      // Format fallback also returns garbage → resolves 3600
      spawnMock
        .mockReturnValueOnce(makeFakeProc({ stdoutData: 'N/A\n', closeCode: 0 }))
        .mockReturnValueOnce(makeFakeProc({ stdoutData: 'N/A\n', closeCode: 0 }));

      const result = await service.getVideoDuration('/video.mkv');

      expect(result).toBe(3600);
    });

    it('should return 3600 when stream duration is 0', async () => {
      spawnMock
        .mockReturnValueOnce(makeFakeProc({ stdoutData: '0\n', closeCode: 0 }))
        .mockReturnValueOnce(makeFakeProc({ stdoutData: '0\n', closeCode: 0 }));

      const result = await service.getVideoDuration('/video.mkv');

      expect(result).toBe(3600);
    });

    it('should return 3600 on timeout', async () => {
      jest.useFakeTimers();

      const proc = makeFakeProc({ stdoutData: '120\n', closeCode: 0, delay: 99999 });
      spawnMock.mockReturnValue(proc);

      const promise = service.getVideoDuration('/video.mkv');
      jest.advanceTimersByTime(10001);

      const result = await promise;

      expect(result).toBe(3600);
      expect(proc.kill).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getVideoInfo
  // ---------------------------------------------------------------------------

  describe('getVideoInfo', () => {
    it('should return codec and container on success', async () => {
      const output = JSON.stringify({
        streams: [{ codec_name: 'hevc' }],
        format: { format_name: 'matroska,webm' },
      });

      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: output, closeCode: 0 }));

      const result = await service.getVideoInfo('/video.mkv');

      expect(result.codec).toBe('hevc');
      expect(result.container).toBe('matroska');
    });

    it('should return "unknown" for missing streams', async () => {
      const output = JSON.stringify({
        streams: [],
        format: { format_name: 'mp4' },
      });

      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: output, closeCode: 0 }));

      const result = await service.getVideoInfo('/video.mp4');

      expect(result.codec).toBe('unknown');
      expect(result.container).toBe('mp4');
    });

    it('should return "unknown" for missing format', async () => {
      const output = JSON.stringify({
        streams: [{ codec_name: 'h264' }],
        format: {},
      });

      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: output, closeCode: 0 }));

      const result = await service.getVideoInfo('/video.mp4');

      expect(result.container).toBe('unknown');
    });

    it('should reject on non-zero exit code', async () => {
      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: '', closeCode: 1 }));

      await expect(service.getVideoInfo('/video.mkv')).rejects.toThrow(
        'FFprobe failed with code 1'
      );
    });

    it('should reject with parse error on invalid JSON', async () => {
      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: 'not-json', closeCode: 0 }));

      await expect(service.getVideoInfo('/video.mkv')).rejects.toThrow(
        'Failed to parse ffprobe output'
      );
    });

    it('should reject on error event', async () => {
      spawnMock.mockReturnValue(makeFakeProc({ errorEvent: new Error('spawn ENOENT') }));

      await expect(service.getVideoInfo('/video.mkv')).rejects.toThrow('spawn ENOENT');
    });

    it('should reject on timeout', async () => {
      jest.useFakeTimers();

      const proc = makeFakeProc({ stdoutData: '{}', closeCode: 0, delay: 99999 });
      spawnMock.mockReturnValue(proc);

      const promise = service.getVideoInfo('/video.mkv');
      jest.advanceTimersByTime(10001);

      await expect(promise).rejects.toThrow('FFprobe timeout');
    });
  });

  // ---------------------------------------------------------------------------
  // getVideoInfoCached
  // ---------------------------------------------------------------------------

  describe('getVideoInfoCached', () => {
    it('should call getVideoInfo on cache miss and cache the result', async () => {
      const output = JSON.stringify({
        streams: [{ codec_name: 'av1' }],
        format: { format_name: 'matroska,webm' },
      });

      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: output, closeCode: 0 }));

      const result = await service.getVideoInfoCached('/video.mkv');

      expect(result.codec).toBe('av1');
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('should return cached result on second call without spawning ffprobe', async () => {
      const output = JSON.stringify({
        streams: [{ codec_name: 'h264' }],
        format: { format_name: 'mp4' },
      });

      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: output, closeCode: 0 }));

      await service.getVideoInfoCached('/video.mp4');
      spawnMock.mockClear();

      const result = await service.getVideoInfoCached('/video.mp4');

      expect(result.codec).toBe('h264');
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('should refetch when cache entry is expired', async () => {
      const output = JSON.stringify({
        streams: [{ codec_name: 'h264' }],
        format: { format_name: 'mp4' },
      });

      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: output, closeCode: 0 }));

      await service.getVideoInfoCached('/video.mp4');

      // Manually expire the cache entry
      const cached = (service as any).codecCache.get('/video.mp4');
      cached.timestamp = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago

      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: output, closeCode: 0 }));
      await service.getVideoInfoCached('/video.mp4');

      expect(spawnMock).toHaveBeenCalledTimes(2);
    });

    it('should evict oldest cache entry when max size is reached', async () => {
      const output = JSON.stringify({
        streams: [{ codec_name: 'h264' }],
        format: { format_name: 'mp4' },
      });

      // Fill cache to max size
      const maxSize = (service as any).CODEC_CACHE_MAX_SIZE;
      for (let i = 0; i < maxSize; i++) {
        (service as any).codecCache.set(`/video-${i}.mp4`, {
          codec: 'h264',
          container: 'mp4',
          timestamp: new Date(),
        });
      }

      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: output, closeCode: 0 }));
      await service.getVideoInfoCached('/new-video.mp4');

      expect((service as any).codecCache.size).toBe(maxSize);
      expect((service as any).codecCache.has('/new-video.mp4')).toBe(true);
    });

    it('should trigger cleanupCodecCache when cleanup interval has elapsed', async () => {
      const output = JSON.stringify({
        streams: [{ codec_name: 'h264' }],
        format: { format_name: 'mp4' },
      });

      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: output, closeCode: 0 }));

      // Set lastCacheCleanup far in the past
      (service as any).lastCacheCleanup = Date.now() - 2 * 60 * 60 * 1000;

      const cleanupSpy = jest.spyOn(service, 'cleanupCodecCache');

      await service.getVideoInfoCached('/video.mp4');

      expect(cleanupSpy).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // verifyFile
  // ---------------------------------------------------------------------------

  describe('verifyFile', () => {
    it('should return isValid=true when ffprobe exits 0 with output', async () => {
      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: '120.5\n', closeCode: 0 }));

      const result = await service.verifyFile('/video.mkv');

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return isValid=false with error when exit code is non-zero', async () => {
      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: '', closeCode: 1 }));

      const result = await service.verifyFile('/video.mkv');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('exit code 1');
    });

    it('should include ffprobe stderr in error message when non-zero exit + stderr', async () => {
      spawnMock.mockReturnValue(
        makeFakeProc({ stdoutData: '', stderrData: 'moov atom not found', closeCode: 1 })
      );

      const result = await service.verifyFile('/video.mkv');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('moov atom not found');
    });

    it('should mention corrupted/incomplete when no output and no stderr', async () => {
      spawnMock.mockReturnValue(makeFakeProc({ stdoutData: '', closeCode: 0 }));

      const result = await service.verifyFile('/video.mkv');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('corrupted or incomplete');
    });

    it('should return isValid=false on ffprobe error event', async () => {
      spawnMock.mockReturnValue(makeFakeProc({ errorEvent: new Error('ENOENT ffprobe') }));

      const result = await service.verifyFile('/video.mkv');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('ENOENT ffprobe');
    });

    it('should return isValid=false on timeout (SIGKILL)', async () => {
      jest.useFakeTimers();

      const proc = makeFakeProc({ stdoutData: '120\n', closeCode: 0, delay: 999999 });
      spawnMock.mockReturnValue(proc);

      const promise = service.verifyFile('/video.mkv');
      jest.advanceTimersByTime(60001);

      const result = await promise;

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('timed out');
      expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  // ---------------------------------------------------------------------------
  // cleanupCodecCache
  // ---------------------------------------------------------------------------

  describe('cleanupCodecCache', () => {
    it('should remove entries older than TTL', () => {
      const ttl = (service as any).CODEC_CACHE_TTL_MS;

      (service as any).codecCache.set('/old.mkv', {
        codec: 'h264',
        container: 'mp4',
        timestamp: new Date(Date.now() - ttl - 1000),
      });
      (service as any).codecCache.set('/fresh.mkv', {
        codec: 'hevc',
        container: 'matroska',
        timestamp: new Date(),
      });

      service.cleanupCodecCache();

      expect((service as any).codecCache.has('/old.mkv')).toBe(false);
      expect((service as any).codecCache.has('/fresh.mkv')).toBe(true);
    });

    it('should log debug message when entries are removed', () => {
      const ttl = (service as any).CODEC_CACHE_TTL_MS;
      (service as any).codecCache.set('/old.mkv', {
        codec: 'h264',
        container: 'mp4',
        timestamp: new Date(Date.now() - ttl - 1000),
      });

      service.cleanupCodecCache();

      expect((service as any).logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned')
      );
    });

    it('should not log when no entries are removed', () => {
      (service as any).codecCache.set('/fresh.mkv', {
        codec: 'hevc',
        container: 'matroska',
        timestamp: new Date(),
      });

      service.cleanupCodecCache();

      expect((service as any).logger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Cleaned')
      );
    });

    it('should trim cache to max size when oversized after TTL cleanup', () => {
      const maxSize = (service as any).CODEC_CACHE_MAX_SIZE;
      const now = Date.now();

      // Add maxSize + 5 entries all fresh (within TTL) but spread over last few minutes
      for (let i = 0; i < maxSize + 5; i++) {
        (service as any).codecCache.set(`/video-${i}.mkv`, {
          codec: 'h264',
          container: 'mp4',
          // All within last 10 minutes — well within 1-hour TTL
          timestamp: new Date(now - i * 100),
        });
      }

      service.cleanupCodecCache();

      expect((service as any).codecCache.size).toBe(maxSize);
    });
  });
});
