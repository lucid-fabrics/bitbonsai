import { Test, type TestingModule } from '@nestjs/testing';
import { DockerVolumeDetectorService } from '../../docker-volume-detector.service';

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

import { exec } from 'child_process';

const mockExec = exec as unknown as jest.Mock;

// Helper to simulate promisified exec
type ExecCallback = (error: Error | null, result: { stdout: string; stderr: string }) => void;

function mockExecResolve(stdout: string, stderr = '') {
  mockExec.mockImplementation((_cmd: string, callback: ExecCallback) => {
    callback(null, { stdout, stderr });
  });
}

function mockExecReject(error: Error) {
  mockExec.mockImplementation((_cmd: string, callback: ExecCallback) => {
    callback(error, { stdout: '', stderr: '' });
  });
}

function mockExecSequence(responses: Array<{ stdout?: string; stderr?: string; error?: Error }>) {
  let callIndex = 0;
  mockExec.mockImplementation((_cmd: string, callback: ExecCallback) => {
    const response = responses[callIndex] || responses[responses.length - 1];
    callIndex++;
    if (response.error) {
      callback(response.error, { stdout: '', stderr: '' });
    } else {
      callback(null, { stdout: response.stdout || '', stderr: response.stderr || '' });
    }
  });
}

describe('DockerVolumeDetectorService', () => {
  let service: DockerVolumeDetectorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DockerVolumeDetectorService],
    }).compile();

    service = module.get<DockerVolumeDetectorService>(DockerVolumeDetectorService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.clearCache();
  });

  describe('detectVolumes', () => {
    it('should return empty array when not in Docker', async () => {
      mockExecSequence([
        { stdout: 'false' }, // isRunningInDocker check
        { stdout: '' }, // cgroup check
      ]);

      const volumes = await service.detectVolumes();

      expect(volumes).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockExecReject(new Error('exec failed'));

      const volumes = await service.detectVolumes();

      expect(volumes).toEqual([]);
    });

    it('should return cached results on second call', async () => {
      // First call: not in Docker
      mockExecSequence([{ stdout: 'false' }, { stdout: '' }]);

      const first = await service.detectVolumes();

      // Modify mock, but cache should be used
      mockExecResolve('true');

      const second = await service.detectVolumes();

      expect(first).toEqual(second);
      expect(first).toEqual([]);
    });
  });

  describe('clearCache', () => {
    it('should clear cached volumes', async () => {
      // Populate cache
      mockExecSequence([{ stdout: 'false' }, { stdout: '' }]);
      await service.detectVolumes();

      service.clearCache();

      // Next call should re-detect
      mockExecSequence([{ stdout: 'false' }, { stdout: '' }]);
      const volumes = await service.detectVolumes();
      expect(volumes).toEqual([]);
    });
  });

  describe('getSuggestedShareName', () => {
    it('should convert /media to Media', () => {
      expect(service.getSuggestedShareName('/media')).toBe('Media');
    });

    it('should convert /data/videos to Data Videos', () => {
      expect(service.getSuggestedShareName('/data/videos')).toBe('Data Videos');
    });

    it('should handle trailing slashes', () => {
      expect(service.getSuggestedShareName('/media/')).toBe('Media');
    });

    it('should handle multiple path segments', () => {
      expect(service.getSuggestedShareName('/mnt/user/media')).toBe('Mnt User Media');
    });

    it('should capitalize first letter of each segment', () => {
      expect(service.getSuggestedShareName('/downloads')).toBe('Downloads');
    });
  });

  describe('detectVolumes - in Docker via dockerenv', () => {
    it('should detect volumes when running in Docker via .dockerenv', async () => {
      const mockContainerInfo = JSON.stringify([
        {
          Mounts: [
            { Type: 'bind', Source: '/mnt/user/media', Destination: '/media', RW: true },
            { Type: 'bind', Source: '/etc/resolv.conf', Destination: '/etc/resolv.conf', RW: true },
          ],
        },
      ]);

      mockExecSequence([
        { stdout: 'true' }, // isRunningInDocker: .dockerenv found
        { stdout: 'test-hostname' }, // getHostname
        { stdout: mockContainerInfo }, // docker inspect hostname
      ]);

      const volumes = await service.detectVolumes();

      expect(volumes.length).toBe(1);
      expect(volumes[0].source).toBe('/mnt/user/media');
      expect(volumes[0].destination).toBe('/media');
      expect(volumes[0].readOnly).toBe(false);
    });

    it('should detect volumes when running in Docker via cgroup', async () => {
      const mockContainerInfo = JSON.stringify([
        {
          Mounts: [
            { Type: 'bind', Source: '/mnt/user/downloads', Destination: '/downloads', RW: false },
          ],
        },
      ]);

      mockExecSequence([
        { stdout: 'false' }, // .dockerenv check fails
        { stdout: 'docker/abc123' }, // cgroup check shows docker
        { stdout: 'abc123hostname' }, // getHostname
        { stdout: mockContainerInfo }, // docker inspect hostname
      ]);

      const volumes = await service.detectVolumes();

      expect(volumes.length).toBe(1);
      expect(volumes[0].readOnly).toBe(true);
    });

    it('should fall back to cgroup method when hostname inspect fails', async () => {
      const containerId = 'a'.repeat(64);
      const mockContainerInfo = JSON.stringify([
        {
          Mounts: [{ Type: 'bind', Source: '/mnt/cache/appdata', Destination: '/data', RW: true }],
        },
      ]);

      mockExecSequence([
        { stdout: 'true' }, // .dockerenv found
        { stdout: 'myhostname' }, // getHostname
        { error: new Error('not found') }, // docker inspect hostname fails
        { error: new Error('not found') }, // docker inspect bitbonsai-backend fails
        { error: new Error('not found') }, // docker inspect HOSTNAME fails
        { stdout: `docker/${containerId}` }, // getContainerIdFromCgroup
        { stdout: mockContainerInfo }, // docker inspect container ID
      ]);

      process.env.HOSTNAME = undefined as any;

      const volumes = await service.detectVolumes();

      expect(volumes.length).toBe(1);
      expect(volumes[0].destination).toBe('/data');
    });

    it('should return empty array when all inspection methods fail', async () => {
      mockExecSequence([
        { stdout: 'true' }, // .dockerenv found
        { stdout: 'myhostname' }, // getHostname
        { error: new Error('not found') }, // docker inspect hostname fails
        { error: new Error('not found') }, // docker inspect bitbonsai-backend fails
        { error: new Error('not found') }, // docker inspect HOSTNAME fails
        { error: new Error('cgroup error') }, // getContainerIdFromCgroup fails
      ]);

      process.env.HOSTNAME = undefined as any;

      const volumes = await service.detectVolumes();

      expect(volumes).toEqual([]);
    });
  });

  describe('filterSystemMounts - path filtering', () => {
    it('should exclude system paths like /etc/hostname', () => {
      const result = (service as any).filterSystemMounts([
        {
          source: '/host/etc/hostname',
          destination: '/etc/hostname',
          readOnly: true,
          type: 'bind',
        },
      ]);
      expect(result).toHaveLength(0);
    });

    it('should exclude paths under /app', () => {
      const result = (service as any).filterSystemMounts([
        { source: '/host/app', destination: '/app', readOnly: false, type: 'bind' },
        { source: '/host/app/config', destination: '/app/config', readOnly: false, type: 'bind' },
      ]);
      expect(result).toHaveLength(0);
    });

    it('should exclude very short paths (< 3 chars)', () => {
      const result = (service as any).filterSystemMounts([
        { source: '/x', destination: '/x', readOnly: false, type: 'bind' },
      ]);
      expect(result).toHaveLength(0);
    });

    it('should include /media paths', () => {
      const result = (service as any).filterSystemMounts([
        { source: '/host/media', destination: '/media', readOnly: false, type: 'bind' },
      ]);
      expect(result).toHaveLength(1);
    });

    it('should include paths with Unraid source pattern /mnt/user/', () => {
      const result = (service as any).filterSystemMounts([
        { source: '/mnt/user/tv', destination: '/tv-shows', readOnly: false, type: 'bind' },
      ]);
      expect(result).toHaveLength(1);
    });

    it('should exclude paths that match neither allowed dest nor allowed source', () => {
      const result = (service as any).filterSystemMounts([
        { source: '/some/random', destination: '/random', readOnly: false, type: 'bind' },
      ]);
      expect(result).toHaveLength(0);
    });

    it('should include /storage paths', () => {
      const result = (service as any).filterSystemMounts([
        { source: '/host/storage', destination: '/storage', readOnly: false, type: 'bind' },
        { source: '/host/storage/nas', destination: '/storage/nas', readOnly: true, type: 'bind' },
      ]);
      expect(result).toHaveLength(2);
    });
  });

  describe('parseVolumeMounts', () => {
    it('should only include bind mounts', () => {
      const containerInfo = {
        Mounts: [
          { Type: 'bind', Source: '/mnt/user/media', Destination: '/media', RW: true },
          { Type: 'volume', Source: 'some-volume', Destination: '/data', RW: true },
          { Type: 'tmpfs', Source: '', Destination: '/tmp', RW: true },
        ],
      };

      const result = (service as any).parseVolumeMounts(containerInfo);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('bind');
    });

    it('should return empty array when Mounts is undefined', () => {
      const result = (service as any).parseVolumeMounts({});
      expect(result).toEqual([]);
    });

    it('should correctly map readOnly from RW field', () => {
      const containerInfo = {
        Mounts: [{ Type: 'bind', Source: '/mnt/user/media', Destination: '/media', RW: false }],
      };

      const result = (service as any).parseVolumeMounts(containerInfo);

      expect(result[0].readOnly).toBe(true);
    });
  });

  describe('detectVolumes - cache invalidation', () => {
    it('should re-detect after cache TTL expires', async () => {
      // Populate cache
      mockExecSequence([{ stdout: 'false' }, { stdout: '' }]);
      await service.detectVolumes();

      // Force cache expiry
      (service as any).lastDetection = Date.now() - 6 * 60 * 1000; // 6 minutes ago

      // Next call should re-detect
      mockExecSequence([{ stdout: 'false' }, { stdout: '' }]);
      const volumes = await service.detectVolumes();
      expect(volumes).toEqual([]);
    });
  });

  // ── getContainerIdFromCgroup — no match ───────────────────────────────────

  describe('getContainerIdFromCgroup - no match', () => {
    it('throws when cgroup output does not contain docker ID', async () => {
      mockExecSequence([
        { stdout: '12:memory:/system.slice/some-service.service\n' }, // no docker ID pattern
      ]);

      await expect((service as any).getContainerIdFromCgroup()).rejects.toThrow(
        'Could not extract container ID from cgroup'
      );
    });

    it('extracts container ID when cgroup has docker/ pattern', async () => {
      const containerId = 'b'.repeat(64);
      mockExecSequence([{ stdout: `12:memory:/docker/${containerId}\n` }]);

      const result = await (service as any).getContainerIdFromCgroup();
      expect(result).toBe(containerId);
    });
  });

  // ── getSuggestedShareName — additional paths ──────────────────────────────

  describe('getSuggestedShareName - additional paths', () => {
    it('returns Downloads for /downloads path', () => {
      expect(service.getSuggestedShareName('/downloads')).toBe('Downloads');
    });

    it('returns capitalized segments for nested /mnt/user/movies path', () => {
      const result = service.getSuggestedShareName('/mnt/user/movies');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toBe(result[0].toUpperCase());
    });

    it('handles path with trailing slash', () => {
      const result = service.getSuggestedShareName('/media/');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ── filterSystemMounts — additional cases ─────────────────────────────────

  describe('filterSystemMounts - additional cases', () => {
    it('excludes /var paths', () => {
      const result = (service as any).filterSystemMounts([
        { source: '/host/var/lib', destination: '/var', readOnly: false, type: 'bind' },
      ]);
      expect(result).toHaveLength(0);
    });

    it('excludes /proc paths', () => {
      const result = (service as any).filterSystemMounts([
        { source: '/proc', destination: '/proc', readOnly: true, type: 'bind' },
      ]);
      expect(result).toHaveLength(0);
    });

    it('includes /data paths', () => {
      const result = (service as any).filterSystemMounts([
        { source: '/mnt/cache/appdata', destination: '/data', readOnly: false, type: 'bind' },
      ]);
      expect(result).toHaveLength(1);
    });

    it('returns empty array for empty input', () => {
      const result = (service as any).filterSystemMounts([]);
      expect(result).toHaveLength(0);
    });

    it('includes multiple valid mounts', () => {
      const result = (service as any).filterSystemMounts([
        { source: '/mnt/user/media', destination: '/media', readOnly: false, type: 'bind' },
        { source: '/mnt/user/tv', destination: '/tv', readOnly: false, type: 'bind' },
      ]);
      expect(result).toHaveLength(2);
    });
  });

  // ── detectVolumes — cached result ─────────────────────────────────────────

  describe('detectVolumes - returns cached result', () => {
    it('returns cached volumes without re-running exec when cache is fresh', async () => {
      const mockContainerInfo = JSON.stringify([
        {
          Mounts: [{ Type: 'bind', Source: '/mnt/user/media', Destination: '/media', RW: true }],
        },
      ]);

      mockExecSequence([
        { stdout: 'true' },
        { stdout: 'test-host' },
        { stdout: mockContainerInfo },
      ]);

      // First call populates cache
      const first = await service.detectVolumes();
      expect(first).toHaveLength(1);

      // Second call should use cache (no new exec calls)
      const callCountBefore = (exec as unknown as jest.Mock).mock.calls.length;
      const second = await service.detectVolumes();
      const callCountAfter = (exec as unknown as jest.Mock).mock.calls.length;

      expect(second).toHaveLength(1);
      expect(callCountAfter).toBe(callCountBefore); // no new exec calls
    });
  });
});
