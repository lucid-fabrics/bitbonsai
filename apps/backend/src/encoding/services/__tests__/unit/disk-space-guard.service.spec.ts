// ── fs mock ──────────────────────────────────────────────────────────────────
const mockStatfs = jest.fn() as jest.Mock;
const mockReadFile = jest.fn() as jest.Mock;

jest.mock('node:fs', () => ({
  promises: {
    statfs: mockStatfs,
    readFile: mockReadFile,
  },
}));

// Import after mock registration
import { DiskSpaceGuardService } from '../../disk-space-guard.service';

// ── helpers ───────────────────────────────────────────────────────────────────
/** Build a statfs result where freeBytes = bfree * bsize */
function makeStatfs(freeBytes: bigint): { bfree: number; bsize: number } {
  const bsize = 4096;
  return { bfree: Number(freeBytes / BigInt(bsize)), bsize };
}

const TWO_GB = BigInt(2 * 1024 ** 3);
const BELOW_2GB = TWO_GB - BigInt(1);
const ABOVE_2GB = TWO_GB + BigInt(1024 ** 2); // 2 GB + 1 MB

// ── suite ─────────────────────────────────────────────────────────────────────
describe('DiskSpaceGuardService', () => {
  let service: DiskSpaceGuardService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new DiskSpaceGuardService();

    // Silence logger
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'debug').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ── startMonitoring ─────────────────────────────────────────────────────────
  describe('startMonitoring', () => {
    it('creates an entry in the monitors map', () => {
      service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);

      const entry = (service as any).monitors.get('job-1');
      expect(entry).toBeDefined();
      expect(entry.pid).toBe(1234);
      expect(entry.outputDir).toBe('/mnt/data/out');
      expect(entry.isPaused).toBe(false);
      expect(entry.interval).not.toBeNull();
    });

    it('stops an existing monitor before starting a new one for the same jobId', () => {
      service.startMonitoring('job-1', '/mnt/data/out/v1.mkv', 1000);
      const firstEntry = (service as any).monitors.get('job-1');
      const stopSpy = jest.spyOn(service, 'stopMonitoring');

      service.startMonitoring('job-1', '/mnt/data/out/v2.mkv', 2000);

      expect(stopSpy).toHaveBeenCalledWith('job-1');
      const newEntry = (service as any).monitors.get('job-1');
      expect(newEntry).not.toBe(firstEntry);
      expect(newEntry.pid).toBe(2000);
    });

    it('sets up a 30 s interval that calls checkDiskSpace', async () => {
      mockStatfs.mockResolvedValue(makeStatfs(ABOVE_2GB));

      service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);
      const checkSpy = jest.spyOn(service as any, 'checkDiskSpace');

      await jest.advanceTimersByTimeAsync(30_000);

      expect(checkSpy).toHaveBeenCalledWith('job-1');
    });
  });

  // ── stopMonitoring ──────────────────────────────────────────────────────────
  describe('stopMonitoring', () => {
    it('no-ops for an unknown jobId', () => {
      expect(() => service.stopMonitoring('no-such-job')).not.toThrow();
    });

    it('clears the main interval and removes the entry', () => {
      service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);
      expect((service as any).monitors.has('job-1')).toBe(true);

      service.stopMonitoring('job-1');

      expect((service as any).monitors.has('job-1')).toBe(false);
    });

    it('sends SIGCONT when isPaused=true', () => {
      service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);
      const entry = (service as any).monitors.get('job-1');
      entry.isPaused = true;

      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
      service.stopMonitoring('job-1');

      expect(killSpy).toHaveBeenCalledWith(1234, 'SIGCONT');
    });

    it('does NOT send SIGCONT when isPaused=false', () => {
      service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      service.stopMonitoring('job-1');

      expect(killSpy).not.toHaveBeenCalled();
    });

    it('clears the recovery interval when it exists', () => {
      service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);
      const entry = (service as any).monitors.get('job-1');
      const fakeRecovery = setInterval(() => {
        /* placeholder */
      }, 99999);
      entry.recoveryInterval = fakeRecovery;
      const clearSpy = jest.spyOn(global, 'clearInterval');

      service.stopMonitoring('job-1');

      expect(clearSpy).toHaveBeenCalledWith(fakeRecovery);
    });
  });

  // ── checkDiskSpace ──────────────────────────────────────────────────────────
  describe('checkDiskSpace (private — tested via bracket notation)', () => {
    it('no-ops when no entry exists for the jobId', async () => {
      mockStatfs.mockResolvedValue(makeStatfs(BELOW_2GB));
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      await (service as any).checkDiskSpace('unknown-job');

      expect(killSpy).not.toHaveBeenCalled();
    });

    it('no-ops when the entry is already paused', async () => {
      service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);
      const entry = (service as any).monitors.get('job-1');
      entry.isPaused = true;

      mockStatfs.mockResolvedValue(makeStatfs(BELOW_2GB));
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      await (service as any).checkDiskSpace('job-1');

      expect(killSpy).not.toHaveBeenCalled();
    });

    it('does NOT send SIGSTOP when free space >= 2 GB', async () => {
      service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);
      mockStatfs.mockResolvedValue(makeStatfs(ABOVE_2GB));
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      await (service as any).checkDiskSpace('job-1');

      expect(killSpy).not.toHaveBeenCalled();
    });

    it('sends SIGSTOP when free space < 2 GB and PID is still ffmpeg', async () => {
      service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);
      mockStatfs.mockResolvedValue(makeStatfs(BELOW_2GB));
      mockReadFile.mockResolvedValue('ffmpeg\n');
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      await (service as any).checkDiskSpace('job-1');

      expect(killSpy).toHaveBeenCalledWith(1234, 'SIGSTOP');
    });

    it('skips SIGSTOP and stops monitoring when PID is no longer ffmpeg', async () => {
      service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);
      mockStatfs.mockResolvedValue(makeStatfs(BELOW_2GB));
      mockReadFile.mockResolvedValue('python3\n'); // different process
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      await (service as any).checkDiskSpace('job-1');

      expect(killSpy).not.toHaveBeenCalledWith(1234, 'SIGSTOP');
      expect((service as any).monitors.has('job-1')).toBe(false);
    });

    it('sets isPaused=true and creates recovery interval after SIGSTOP', async () => {
      service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);
      mockStatfs.mockResolvedValue(makeStatfs(BELOW_2GB));
      mockReadFile.mockResolvedValue('ffmpeg\n');
      jest.spyOn(process, 'kill').mockImplementation(() => true);

      await (service as any).checkDiskSpace('job-1');

      const entry = (service as any).monitors.get('job-1');
      expect(entry.isPaused).toBe(true);
      expect(entry.recoveryInterval).not.toBeNull();
      expect(entry.interval).toBeNull(); // regular poll stopped
    });

    describe('recovery: disk space restored', () => {
      it('sends SIGCONT and restarts regular poll when space recovers', async () => {
        service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);

        // First checkDiskSpace call: below threshold → SIGSTOP
        mockStatfs.mockResolvedValueOnce(makeStatfs(BELOW_2GB));
        mockReadFile.mockResolvedValue('ffmpeg\n');
        const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

        await (service as any).checkDiskSpace('job-1');
        expect(killSpy).toHaveBeenCalledWith(1234, 'SIGSTOP');

        // Recovery interval tick: space now OK
        mockStatfs.mockResolvedValue(makeStatfs(ABOVE_2GB));
        await jest.advanceTimersByTimeAsync(10_000);

        expect(killSpy).toHaveBeenCalledWith(1234, 'SIGCONT');
        const entry = (service as any).monitors.get('job-1');
        expect(entry?.isPaused).toBe(false);
        expect(entry?.interval).not.toBeNull();
      });
    });

    describe('recovery: 10-minute timeout', () => {
      it('sends SIGCONT after 10 minutes without recovery and stops monitoring', async () => {
        service.startMonitoring('job-1', '/mnt/data/out/video.mkv', 1234);

        mockStatfs.mockResolvedValue(makeStatfs(BELOW_2GB));
        mockReadFile.mockResolvedValue('ffmpeg\n');
        const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

        // Initial SIGSTOP
        await (service as any).checkDiskSpace('job-1');
        expect(killSpy).toHaveBeenCalledWith(1234, 'SIGSTOP');

        // Advance 10 minutes (60 × 10 s recovery ticks)
        await jest.advanceTimersByTimeAsync(10 * 60 * 1000);

        expect(killSpy).toHaveBeenCalledWith(1234, 'SIGCONT');
        expect((service as any).monitors.has('job-1')).toBe(false);
      });
    });
  });

  // ── isPidStillFfmpeg ────────────────────────────────────────────────────────
  describe('isPidStillFfmpeg (private)', () => {
    it('returns true when /proc/PID/comm contains "ffmpeg"', async () => {
      mockReadFile.mockResolvedValue('ffmpeg\n');

      const result = await (service as any).isPidStillFfmpeg(1234);

      expect(result).toBe(true);
      expect(mockReadFile).toHaveBeenCalledWith('/proc/1234/comm', 'utf8');
    });

    it('returns false when /proc/PID/comm contains a different process name', async () => {
      mockReadFile.mockResolvedValue('node\n');

      const result = await (service as any).isPidStillFfmpeg(1234);

      expect(result).toBe(false);
    });

    it('falls back to signal-0 check when /proc is unavailable and returns true if process exists', async () => {
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      const result = await (service as any).isPidStillFfmpeg(1234);

      expect(killSpy).toHaveBeenCalledWith(1234, 0);
      expect(result).toBe(true);
    });

    it('returns false via signal-0 fallback when process is gone (ESRCH)', async () => {
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      jest.spyOn(process, 'kill').mockImplementation(() => {
        const err = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
        throw err;
      });

      const result = await (service as any).isPidStillFfmpeg(1234);

      expect(result).toBe(false);
    });
  });
});
