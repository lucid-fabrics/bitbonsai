// ── fs mock ───────────────────────────────────────────────────────────────────
const mockAccess = jest.fn() as jest.Mock;
const mockReadFile = jest.fn() as jest.Mock;

jest.mock('node:fs', () => ({
  promises: {
    access: mockAccess,
    readFile: mockReadFile,
  },
  constants: { R_OK: 4 },
}));

import { NfsHealthService } from '../../nfs-health.service';

// ── suite ─────────────────────────────────────────────────────────────────────
describe('NfsHealthService', () => {
  let service: NfsHealthService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new NfsHealthService();

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
    it('creates an entry with mountPath = dirname(filePath)', () => {
      service.startMonitoring('job-1', '/mnt/nfs/media/video.mkv', 5678);

      const entry = (service as any).monitors.get('job-1');
      expect(entry).toBeDefined();
      expect(entry.mountPath).toBe('/mnt/nfs/media');
      expect(entry.pid).toBe(5678);
      expect(entry.isStopped).toBe(false);
      expect(entry.interval).not.toBeNull();
    });

    it('stops an existing monitor before starting a new one for the same jobId', () => {
      service.startMonitoring('job-1', '/mnt/nfs/a/v1.mkv', 1000);
      const stopSpy = jest.spyOn(service, 'stopMonitoring');

      service.startMonitoring('job-1', '/mnt/nfs/b/v2.mkv', 2000);

      expect(stopSpy).toHaveBeenCalledWith('job-1');
      const entry = (service as any).monitors.get('job-1');
      expect(entry.pid).toBe(2000);
      expect(entry.mountPath).toBe('/mnt/nfs/b');
    });

    it('sets up a 30 s interval that calls checkHealth', async () => {
      mockAccess.mockResolvedValue(undefined); // mount reachable
      service.startMonitoring('job-1', '/mnt/nfs/media/video.mkv', 5678);
      const checkSpy = jest.spyOn(service as any, 'checkHealth');

      await jest.advanceTimersByTimeAsync(30_000);

      expect(checkSpy).toHaveBeenCalledWith('job-1');
    });
  });

  // ── stopMonitoring ──────────────────────────────────────────────────────────
  describe('stopMonitoring', () => {
    it('no-ops for an unknown jobId', () => {
      expect(() => service.stopMonitoring('no-such-job')).not.toThrow();
    });

    it('removes the entry from the monitors map', () => {
      service.startMonitoring('job-1', '/mnt/nfs/media/video.mkv', 5678);
      service.stopMonitoring('job-1');

      expect((service as any).monitors.has('job-1')).toBe(false);
    });

    it('sends SIGCONT when isStopped=true', () => {
      service.startMonitoring('job-1', '/mnt/nfs/media/video.mkv', 5678);
      const entry = (service as any).monitors.get('job-1');
      entry.isStopped = true;

      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
      service.stopMonitoring('job-1');

      expect(killSpy).toHaveBeenCalledWith(5678, 'SIGCONT');
    });

    it('does NOT send SIGCONT when isStopped=false', () => {
      service.startMonitoring('job-1', '/mnt/nfs/media/video.mkv', 5678);
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      service.stopMonitoring('job-1');

      expect(killSpy).not.toHaveBeenCalled();
    });

    it('clears both main and recovery intervals', () => {
      service.startMonitoring('job-1', '/mnt/nfs/media/video.mkv', 5678);
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

  // ── checkHealth ─────────────────────────────────────────────────────────────
  describe('checkHealth (private — tested via bracket notation)', () => {
    it('no-ops when mount is reachable', async () => {
      service.startMonitoring('job-1', '/mnt/nfs/media/video.mkv', 5678);
      mockAccess.mockResolvedValue(undefined);
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      await (service as any).checkHealth('job-1');

      expect(killSpy).not.toHaveBeenCalled();
    });

    it('no-ops when entry isStopped=true', async () => {
      service.startMonitoring('job-1', '/mnt/nfs/media/video.mkv', 5678);
      const entry = (service as any).monitors.get('job-1');
      entry.isStopped = true;

      mockAccess.mockRejectedValue(new Error('EACCES'));
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      await (service as any).checkHealth('job-1');

      expect(killSpy).not.toHaveBeenCalled();
    });

    it('sends SIGSTOP when mount unreachable and PID is still ffmpeg', async () => {
      service.startMonitoring('job-1', '/mnt/nfs/media/video.mkv', 5678);
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockReadFile.mockResolvedValue('ffmpeg\n');
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      await (service as any).checkHealth('job-1');

      expect(killSpy).toHaveBeenCalledWith(5678, 'SIGSTOP');
      const entry = (service as any).monitors.get('job-1');
      expect(entry.isStopped).toBe(true);
      expect(entry.recoveryInterval).not.toBeNull();
      expect(entry.interval).toBeNull();
    });

    it('skips SIGSTOP and stops monitoring when PID is no longer ffmpeg', async () => {
      service.startMonitoring('job-1', '/mnt/nfs/media/video.mkv', 5678);
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockReadFile.mockResolvedValue('node\n');
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      await (service as any).checkHealth('job-1');

      expect(killSpy).not.toHaveBeenCalledWith(5678, 'SIGSTOP');
      expect((service as any).monitors.has('job-1')).toBe(false);
    });

    describe('recovery: mount comes back', () => {
      it('sends SIGCONT and restarts regular poll when mount recovers', async () => {
        service.startMonitoring('job-1', '/mnt/nfs/media/video.mkv', 5678);

        // Trigger SIGSTOP
        mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
        mockReadFile.mockResolvedValue('ffmpeg\n');
        const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

        await (service as any).checkHealth('job-1');
        expect(killSpy).toHaveBeenCalledWith(5678, 'SIGSTOP');

        // Recovery tick: mount reachable now
        mockAccess.mockResolvedValue(undefined);
        await jest.advanceTimersByTimeAsync(10_000);

        expect(killSpy).toHaveBeenCalledWith(5678, 'SIGCONT');
        const entry = (service as any).monitors.get('job-1');
        expect(entry?.isStopped).toBe(false);
        expect(entry?.interval).not.toBeNull();
      });
    });

    describe('recovery: MAX_RECOVERY_ATTEMPTS (30) exceeded', () => {
      it('sends SIGCONT after 30 failed recovery ticks and stops monitoring', async () => {
        service.startMonitoring('job-1', '/mnt/nfs/media/video.mkv', 5678);

        // Trigger SIGSTOP
        mockAccess.mockRejectedValue(new Error('ENOENT'));
        mockReadFile.mockResolvedValue('ffmpeg\n');
        const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

        await (service as any).checkHealth('job-1');
        expect(killSpy).toHaveBeenCalledWith(5678, 'SIGSTOP');

        // Advance 30 × 10 s = 300 s without recovery
        await jest.advanceTimersByTimeAsync(30 * 10_000);

        expect(killSpy).toHaveBeenCalledWith(5678, 'SIGCONT');
        expect((service as any).monitors.has('job-1')).toBe(false);
      });
    });
  });

  // ── isPidStillFfmpeg ────────────────────────────────────────────────────────
  describe('isPidStillFfmpeg (private)', () => {
    it('returns true when /proc/PID/comm = "ffmpeg"', async () => {
      mockReadFile.mockResolvedValue('ffmpeg\n');

      const result = await (service as any).isPidStillFfmpeg(5678);

      expect(result).toBe(true);
      expect(mockReadFile).toHaveBeenCalledWith('/proc/5678/comm', 'utf8');
    });

    it('returns false when /proc/PID/comm is a different process name', async () => {
      mockReadFile.mockResolvedValue('python3\n');

      const result = await (service as any).isPidStillFfmpeg(5678);

      expect(result).toBe(false);
    });

    it('falls back to signal-0 and returns true when process exists but /proc unavailable', async () => {
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      const result = await (service as any).isPidStillFfmpeg(5678);

      expect(killSpy).toHaveBeenCalledWith(5678, 0);
      expect(result).toBe(true);
    });

    it('returns false via signal-0 fallback when process is gone (ESRCH)', async () => {
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      jest.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      });

      const result = await (service as any).isPidStillFfmpeg(5678);

      expect(result).toBe(false);
    });
  });
});
