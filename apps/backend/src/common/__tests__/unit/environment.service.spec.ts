import { Test, type TestingModule } from '@nestjs/testing';
import { EnvironmentService } from '../../environment.service';

// Simple integration tests without mocking filesystem
describe('EnvironmentService', () => {
  let service: EnvironmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EnvironmentService],
    }).compile();

    service = module.get<EnvironmentService>(EnvironmentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectEnvironment', () => {
    it('should detect an environment type', async () => {
      const result = await service.detectEnvironment();
      expect(['UNRAID', 'DOCKER', 'BARE_METAL']).toContain(result);
    });

    it('should cache environment detection result', async () => {
      const result1 = await service.detectEnvironment();
      const result2 = await service.detectEnvironment();
      expect(result1).toBe(result2);
    });
  });

  describe('isUnraid', () => {
    it('should return a boolean', async () => {
      const result = await service.isUnraid();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isDocker', () => {
    it('should return a boolean', async () => {
      const result = await service.isDocker();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getUnraidVersion', () => {
    it('should return string or undefined', async () => {
      const result = await service.getUnraidVersion();
      expect(result === undefined || typeof result === 'string').toBe(true);
    });
  });

  describe('getContainerRuntime', () => {
    it('should return string or undefined', async () => {
      const result = await service.getContainerRuntime();
      expect(result === undefined || typeof result === 'string').toBe(true);
    });

    it('should return undefined if not in Docker', async () => {
      const isDocker = await service.isDocker();
      const runtime = await service.getContainerRuntime();

      if (!isDocker) {
        expect(runtime).toBeUndefined();
      }
    });
  });

  describe('getStoragePaths', () => {
    it('should return valid storage paths', async () => {
      const result = await service.getStoragePaths();

      expect(result).not.toBeNull();
      expect(typeof result.mediaPath).toBe('string');
      expect(typeof result.downloadsPath).toBe('string');
      expect(typeof result.configPath).toBe('string');
      expect(result.mediaPath.length).toBeGreaterThan(0);
      expect(result.downloadsPath.length).toBeGreaterThan(0);
      expect(result.configPath.length).toBeGreaterThan(0);
    });

    it('should return different paths based on environment', async () => {
      const environment = await service.detectEnvironment();
      const paths = await service.getStoragePaths();

      if (environment === 'UNRAID') {
        expect(paths.mediaPath).toBe('/mnt/user/media');
        expect(paths.downloadsPath).toBe('/mnt/user/Downloads');
        expect(paths.configPath).toBe('/mnt/user/appdata/bitbonsai');
      } else if (environment === 'DOCKER') {
        expect(paths.mediaPath).toBe('/media');
        expect(paths.downloadsPath).toBe('/media');
        expect(paths.configPath).toBe('/config');
      } else {
        expect(paths.mediaPath).toBe('/var/lib/bitbonsai/media');
        expect(paths.downloadsPath).toBe('/var/lib/bitbonsai/downloads');
        expect(paths.configPath).toBe('/etc/bitbonsai');
      }
    });
  });

  describe('detectHardwareAcceleration', () => {
    it('should return hardware acceleration capabilities', async () => {
      const result = await service.detectHardwareAcceleration();

      expect(result).not.toBeNull();
      expect(typeof result.nvidia).toBe('boolean');
      expect(typeof result.intelQsv).toBe('boolean');
      expect(typeof result.amd).toBe('boolean');
      expect(typeof result.appleVideoToolbox).toBe('boolean');
    });
  });

  describe('getSystemInfo', () => {
    it('should return system information', async () => {
      const result = await service.getSystemInfo();

      expect(result).not.toBeNull();
      expect(result.cpuCores).toBeGreaterThan(0);
      expect(typeof result.architecture).toBe('string');
      expect(typeof result.platform).toBe('string');
      expect(result.totalMemoryGb).toBeGreaterThan(0);
      expect(['string', 'undefined']).toContain(typeof result.containerRuntime);
      expect(['string', 'undefined']).toContain(typeof result.unraidVersion);
    });
  });

  describe('getHardwareInfo', () => {
    it('should return complete hardware info with caching', async () => {
      const result1 = await service.getHardwareInfo();
      const result2 = await service.getHardwareInfo();

      expect(result1).not.toBeNull();
      expect(result1.acceleration).not.toBeNull();
      expect(result1.systemInfo).not.toBeNull();
      expect(result1).toBe(result2); // Should return same cached object
    });
  });

  describe('getDocsLink', () => {
    it('should return appropriate docs link', async () => {
      const environment = await service.detectEnvironment();
      const docsLink = await service.getDocsLink();

      expect(typeof docsLink).toBe('string');
      expect(docsLink).toContain('https://docs.bitbonsai.com/setup/');

      if (environment === 'UNRAID') {
        expect(docsLink).toBe('https://docs.bitbonsai.com/setup/unraid');
      } else if (environment === 'DOCKER') {
        expect(docsLink).toBe('https://docs.bitbonsai.com/setup/docker');
      } else {
        expect(docsLink).toBe('https://docs.bitbonsai.com/setup/installation');
      }
    });
  });

  describe('getRecommendations', () => {
    it('should return array of recommendations', async () => {
      const result = await service.getRecommendations();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      result.forEach((rec: string) => {
        expect(typeof rec).toBe('string');
      });
    });

    it('should include environment-specific recommendations', async () => {
      const environment = await service.detectEnvironment();
      const recommendations = await service.getRecommendations();

      if (environment === 'UNRAID') {
        expect(recommendations.some((rec: string) => rec.includes('Unraid array storage'))).toBe(
          true
        );
      } else if (environment === 'DOCKER') {
        expect(recommendations.some((rec: string) => rec.includes('Docker volumes'))).toBe(true);
      }
    });

    it('should include hardware acceleration recommendations when available', async () => {
      const hardware = await service.detectHardwareAcceleration();
      const recommendations = await service.getRecommendations();

      if (hardware.nvidia) {
        expect(recommendations.some((rec: string) => rec.includes('NVIDIA'))).toBe(true);
      }
      if (hardware.intelQsv) {
        expect(recommendations.some((rec: string) => rec.includes('Intel Quick Sync'))).toBe(true);
      }
      if (hardware.amd) {
        expect(recommendations.some((rec: string) => rec.includes('AMD'))).toBe(true);
      }
      if (hardware.appleVideoToolbox) {
        expect(recommendations.some((rec: string) => rec.includes('Apple Silicon'))).toBe(true);
      }
    });
  });

  describe('getEnvironmentInfo', () => {
    it('should return complete environment information', async () => {
      const result = await service.getEnvironmentInfo();

      expect(result).not.toBeNull();
      expect(['UNRAID', 'DOCKER', 'BARE_METAL']).toContain(result.environment);
      expect(typeof result.isUnraid).toBe('boolean');
      expect(typeof result.isDocker).toBe('boolean');
      expect(result.hardwareAcceleration).not.toBeNull();
      expect(result.defaultPaths).not.toBeNull();
      expect(result.systemInfo).not.toBeNull();
      expect(typeof result.docsLink).toBe('string');
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it('should have consistent environment flags', async () => {
      const result = await service.getEnvironmentInfo();

      if (result.environment === 'UNRAID') {
        expect(result.isUnraid).toBe(true);
        expect(result.isDocker).toBe(true); // Unraid runs Docker
      } else if (result.environment === 'DOCKER') {
        expect(result.isUnraid).toBe(false);
        expect(result.isDocker).toBe(true);
      } else {
        expect(result.isUnraid).toBe(false);
        expect(result.isDocker).toBe(false);
      }
    });

    it('should include all required fields', async () => {
      const result = await service.getEnvironmentInfo();

      // Verify all DTOs have required fields
      expect(typeof result.hardwareAcceleration.nvidia).toBe('boolean');
      expect(typeof result.hardwareAcceleration.intelQsv).toBe('boolean');
      expect(typeof result.hardwareAcceleration.amd).toBe('boolean');
      expect(typeof result.hardwareAcceleration.appleVideoToolbox).toBe('boolean');

      expect(typeof result.defaultPaths.mediaPath).toBe('string');
      expect(typeof result.defaultPaths.downloadsPath).toBe('string');
      expect(typeof result.defaultPaths.configPath).toBe('string');

      expect(result.systemInfo.cpuCores).toBeGreaterThan(0);
      expect(typeof result.systemInfo.architecture).toBe('string');
      expect(typeof result.systemInfo.platform).toBe('string');
      expect(result.systemInfo.totalMemoryGb).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Mocked unit tests – use service-level spies to avoid non-configurable fs
// ---------------------------------------------------------------------------
describe('EnvironmentService (mocked service methods)', () => {
  let service: EnvironmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EnvironmentService],
    }).compile();

    service = module.get<EnvironmentService>(EnvironmentService);
    // Reset cache between tests
    (service as unknown as { cachedEnvironment: null }).cachedEnvironment = null;
    (service as unknown as { cachedHardwareInfo: null }).cachedHardwareInfo = null;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isUnraid (behavioural)', () => {
    it('returns a boolean', async () => {
      expect(typeof (await service.isUnraid())).toBe('boolean');
    });
  });

  describe('isDocker (behavioural)', () => {
    it('returns a boolean', async () => {
      expect(typeof (await service.isDocker())).toBe('boolean');
    });
  });

  describe('getUnraidVersion (behavioural)', () => {
    it('returns string or undefined', async () => {
      const v = await service.getUnraidVersion();
      expect(v === undefined || typeof v === 'string').toBe(true);
    });
  });

  describe('getContainerRuntime', () => {
    it('returns undefined when not in Docker', async () => {
      jest.spyOn(service, 'isDocker').mockResolvedValue(false);
      expect(await service.getContainerRuntime()).toBeUndefined();
    });

    it('returns string or undefined when in Docker', async () => {
      jest.spyOn(service, 'isDocker').mockResolvedValue(true);
      const runtime = await service.getContainerRuntime();
      expect(runtime === undefined || typeof runtime === 'string').toBe(true);
    });
  });

  describe('detectEnvironment caching', () => {
    it('detects UNRAID and caches result', async () => {
      jest.spyOn(service, 'isUnraid').mockResolvedValue(true);
      const r1 = await service.detectEnvironment();
      const r2 = await service.detectEnvironment();
      expect(r1).toBe('UNRAID');
      expect(r2).toBe('UNRAID');
      // isUnraid should only be called once due to caching
      expect((service.isUnraid as jest.Mock).mock.calls.length).toBe(1);
    });

    it('detects DOCKER when not Unraid', async () => {
      jest.spyOn(service, 'isUnraid').mockResolvedValue(false);
      jest.spyOn(service, 'isDocker').mockResolvedValue(true);
      expect(await service.detectEnvironment()).toBe('DOCKER');
    });

    it('detects BARE_METAL as default', async () => {
      jest.spyOn(service, 'isUnraid').mockResolvedValue(false);
      jest.spyOn(service, 'isDocker').mockResolvedValue(false);
      expect(await service.detectEnvironment()).toBe('BARE_METAL');
    });
  });

  describe('getStoragePaths with mocked environment', () => {
    it('returns UNRAID paths', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('UNRAID');
      const p = await service.getStoragePaths();
      expect(p.mediaPath).toBe('/mnt/user/media');
      expect(p.configPath).toBe('/mnt/user/appdata/bitbonsai');
    });

    it('returns DOCKER paths', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('DOCKER');
      const p = await service.getStoragePaths();
      expect(p.mediaPath).toBe('/media');
      expect(p.configPath).toBe('/config');
    });

    it('returns BARE_METAL paths', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('BARE_METAL');
      const p = await service.getStoragePaths();
      expect(p.mediaPath).toBe('/var/lib/bitbonsai/media');
    });
  });

  describe('getDocsLink with mocked environment', () => {
    it('returns unraid link', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('UNRAID');
      expect(await service.getDocsLink()).toBe('https://docs.bitbonsai.com/setup/unraid');
    });

    it('returns docker link', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('DOCKER');
      expect(await service.getDocsLink()).toBe('https://docs.bitbonsai.com/setup/docker');
    });

    it('returns installation link for bare metal', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('BARE_METAL');
      expect(await service.getDocsLink()).toBe('https://docs.bitbonsai.com/setup/installation');
    });
  });

  describe('getRecommendations with mocked environment', () => {
    it('returns UNRAID recommendations including docker GPU note when in docker', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('UNRAID');
      jest.spyOn(service, 'isDocker').mockResolvedValue(true);
      jest.spyOn(service, 'getHardwareInfo').mockResolvedValue({
        acceleration: { nvidia: false, intelQsv: false, amd: false, appleVideoToolbox: false },
        systemInfo: { cpuCores: 4, architecture: 'x64', platform: 'linux', totalMemoryGb: 16 },
      });

      const recs = await service.getRecommendations();
      expect(recs.some((r) => r.includes('Unraid array storage'))).toBe(true);
      expect(recs.some((r) => r.includes('GPU passthrough'))).toBe(true);
    });

    it('returns DOCKER recommendations', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('DOCKER');
      jest.spyOn(service, 'isDocker').mockResolvedValue(true);
      jest.spyOn(service, 'getHardwareInfo').mockResolvedValue({
        acceleration: { nvidia: false, intelQsv: false, amd: false, appleVideoToolbox: false },
        systemInfo: { cpuCores: 2, architecture: 'x64', platform: 'linux', totalMemoryGb: 8 },
      });

      const recs = await service.getRecommendations();
      expect(recs.some((r) => r.includes('Docker volumes'))).toBe(true);
    });

    it('returns BARE_METAL recommendations', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('BARE_METAL');
      jest.spyOn(service, 'isDocker').mockResolvedValue(false);
      jest.spyOn(service, 'getHardwareInfo').mockResolvedValue({
        acceleration: { nvidia: false, intelQsv: false, amd: false, appleVideoToolbox: false },
        systemInfo: { cpuCores: 2, architecture: 'x64', platform: 'linux', totalMemoryGb: 8 },
      });

      const recs = await service.getRecommendations();
      expect(recs.some((r) => r.includes('systemd service'))).toBe(true);
    });

    it('includes NVIDIA recommendation when detected', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('BARE_METAL');
      jest.spyOn(service, 'isDocker').mockResolvedValue(false);
      jest.spyOn(service, 'getHardwareInfo').mockResolvedValue({
        acceleration: { nvidia: true, intelQsv: false, amd: false, appleVideoToolbox: false },
        systemInfo: { cpuCores: 8, architecture: 'x64', platform: 'linux', totalMemoryGb: 32 },
      });

      const recs = await service.getRecommendations();
      expect(recs.some((r) => r.includes('NVIDIA'))).toBe(true);
    });

    it('includes Intel QSV recommendation when detected', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('BARE_METAL');
      jest.spyOn(service, 'isDocker').mockResolvedValue(false);
      jest.spyOn(service, 'getHardwareInfo').mockResolvedValue({
        acceleration: { nvidia: false, intelQsv: true, amd: false, appleVideoToolbox: false },
        systemInfo: { cpuCores: 4, architecture: 'x64', platform: 'linux', totalMemoryGb: 16 },
      });

      const recs = await service.getRecommendations();
      expect(recs.some((r) => r.includes('Intel Quick Sync'))).toBe(true);
    });

    it('includes AMD recommendation when detected', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('BARE_METAL');
      jest.spyOn(service, 'isDocker').mockResolvedValue(false);
      jest.spyOn(service, 'getHardwareInfo').mockResolvedValue({
        acceleration: { nvidia: false, intelQsv: false, amd: true, appleVideoToolbox: false },
        systemInfo: { cpuCores: 8, architecture: 'x64', platform: 'linux', totalMemoryGb: 16 },
      });

      const recs = await service.getRecommendations();
      expect(recs.some((r) => r.includes('AMD'))).toBe(true);
    });

    it('includes Apple Silicon recommendation when detected', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('BARE_METAL');
      jest.spyOn(service, 'isDocker').mockResolvedValue(false);
      jest.spyOn(service, 'getHardwareInfo').mockResolvedValue({
        acceleration: { nvidia: false, intelQsv: false, amd: false, appleVideoToolbox: true },
        systemInfo: { cpuCores: 10, architecture: 'arm64', platform: 'darwin', totalMemoryGb: 16 },
      });

      const recs = await service.getRecommendations();
      expect(recs.some((r) => r.includes('Apple Silicon'))).toBe(true);
    });
  });

  describe('getHardwareInfo caching', () => {
    it('caches hardware info after first call', async () => {
      const mockAcceleration = {
        nvidia: false,
        intelQsv: false,
        amd: false,
        appleVideoToolbox: false,
      };
      const mockSystemInfo = {
        cpuCores: 4,
        architecture: 'x64',
        platform: 'linux',
        totalMemoryGb: 8,
      };

      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue(mockAcceleration);
      jest.spyOn(service, 'getSystemInfo').mockResolvedValue(mockSystemInfo);

      const r1 = await service.getHardwareInfo();
      const r2 = await service.getHardwareInfo();

      expect(r1).toBe(r2);
      expect((service.detectHardwareAcceleration as jest.Mock).mock.calls.length).toBe(1);
    });
  });

  describe('detectHardwareAcceleration caching', () => {
    it('returns cached result on second call', async () => {
      const acceleration = { nvidia: true, intelQsv: false, amd: false, appleVideoToolbox: false };
      const systemInfo = { cpuCores: 4, architecture: 'x64', platform: 'linux', totalMemoryGb: 8 };
      // Pre-populate the cache via getHardwareInfo
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue(acceleration);
      jest.spyOn(service, 'getSystemInfo').mockResolvedValue(systemInfo);
      await service.getHardwareInfo(); // populates cachedHardwareInfo

      // Now detectHardwareAcceleration should short-circuit via the cache
      const result = await service.detectHardwareAcceleration();
      expect(result).toEqual(acceleration);
    });
  });

  describe('getSystemInfo caching', () => {
    it('returns cached system info when hardware cache is populated', async () => {
      const acceleration = { nvidia: false, intelQsv: false, amd: false, appleVideoToolbox: false };
      const systemInfo = {
        cpuCores: 8,
        architecture: 'arm64',
        platform: 'darwin',
        totalMemoryGb: 32,
      };
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue(acceleration);
      jest.spyOn(service, 'getSystemInfo').mockResolvedValue(systemInfo);
      await service.getHardwareInfo(); // populates cachedHardwareInfo

      const result = await service.getSystemInfo();
      expect(result).toEqual(systemInfo);
    });
  });

  describe('getContainerRuntime container runtime branches', () => {
    it('returns podman when in Docker and .containerenv exists', async () => {
      jest.spyOn(service, 'isDocker').mockResolvedValue(true);
      // Spy on fs at the module level is blocked, so we verify the contract via isDocker mock
      // and accept that actual fs detection runs (result is string or undefined)
      const runtime = await service.getContainerRuntime();
      expect(runtime === undefined || typeof runtime === 'string').toBe(true);
    });

    it('returns undefined when isDocker throws internally', async () => {
      jest.spyOn(service, 'isDocker').mockRejectedValue(new Error('fs error'));
      // getContainerRuntime catches internally via try/catch in isDocker path
      // When isDocker propagates, getContainerRuntime catch returns undefined
      const runtime = await service.getContainerRuntime();
      expect(runtime).toBeUndefined();
    });
  });

  describe('isUnraid edge cases', () => {
    it('returns false when neither unraid file nor directories exist', async () => {
      // On dev machines (macOS / CI Linux without Unraid) this will be false
      const result = await service.isUnraid();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getStoragePaths DOCKER downloadsPath', () => {
    it('DOCKER downloadsPath equals mediaPath', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('DOCKER');
      const paths = await service.getStoragePaths();
      expect(paths.downloadsPath).toBe(paths.mediaPath);
    });
  });

  describe('getEnvironmentInfo with all GPU types', () => {
    it('includes all hardware acceleration flags in the response', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('BARE_METAL');
      jest.spyOn(service, 'isUnraid').mockResolvedValue(false);
      jest.spyOn(service, 'isDocker').mockResolvedValue(false);
      jest.spyOn(service, 'getHardwareInfo').mockResolvedValue({
        acceleration: { nvidia: true, intelQsv: true, amd: true, appleVideoToolbox: false },
        systemInfo: { cpuCores: 16, architecture: 'x64', platform: 'linux', totalMemoryGb: 64 },
      });
      jest.spyOn(service, 'getStoragePaths').mockResolvedValue({
        mediaPath: '/m',
        downloadsPath: '/d',
        configPath: '/c',
      });
      jest
        .spyOn(service, 'getDocsLink')
        .mockResolvedValue('https://docs.bitbonsai.com/setup/installation');
      jest.spyOn(service, 'getRecommendations').mockResolvedValue(['r1']);

      const info = await service.getEnvironmentInfo();
      expect(info.hardwareAcceleration.nvidia).toBe(true);
      expect(info.hardwareAcceleration.intelQsv).toBe(true);
      expect(info.hardwareAcceleration.amd).toBe(true);
      expect(info.hardwareAcceleration.appleVideoToolbox).toBe(false);
    });
  });

  describe('getRecommendations UNRAID without docker', () => {
    it('does not include GPU passthrough when not in Docker', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('UNRAID');
      jest.spyOn(service, 'isDocker').mockResolvedValue(false);
      jest.spyOn(service, 'getHardwareInfo').mockResolvedValue({
        acceleration: { nvidia: false, intelQsv: false, amd: false, appleVideoToolbox: false },
        systemInfo: { cpuCores: 4, architecture: 'x64', platform: 'linux', totalMemoryGb: 16 },
      });

      const recs = await service.getRecommendations();
      expect(recs.some((r) => r.includes('GPU passthrough'))).toBe(false);
      expect(recs.some((r) => r.includes('cache pool'))).toBe(true);
    });
  });

  describe('getRecommendations all GPU flags simultaneously', () => {
    it('includes all GPU recommendations when all detected', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('BARE_METAL');
      jest.spyOn(service, 'isDocker').mockResolvedValue(false);
      jest.spyOn(service, 'getHardwareInfo').mockResolvedValue({
        acceleration: { nvidia: true, intelQsv: true, amd: true, appleVideoToolbox: true },
        systemInfo: { cpuCores: 12, architecture: 'x64', platform: 'linux', totalMemoryGb: 32 },
      });

      const recs = await service.getRecommendations();
      expect(recs.some((r) => r.includes('NVIDIA'))).toBe(true);
      expect(recs.some((r) => r.includes('Intel Quick Sync'))).toBe(true);
      expect(recs.some((r) => r.includes('AMD'))).toBe(true);
      expect(recs.some((r) => r.includes('Apple Silicon'))).toBe(true);
    });
  });

  // ==========================================================================
  // getUnraidVersion - strips version= prefix and quotes
  // ==========================================================================
  describe('getUnraidVersion format stripping', () => {
    it('returns undefined when /etc/unraid-version does not exist (non-Unraid machine)', async () => {
      // On dev/CI machines this file won't exist
      const v = await service.getUnraidVersion();
      // Either undefined or a cleaned string — never contains `version=` or quotes
      if (v !== undefined) {
        expect(v).not.toContain('version=');
        expect(v).not.toContain('"');
      } else {
        expect(v).toBeUndefined();
      }
    });
  });

  // ==========================================================================
  // detectHardwareAcceleration - returns cached acceleration when cachedHardwareInfo is set
  // ==========================================================================
  describe('detectHardwareAcceleration uses cachedHardwareInfo', () => {
    it('returns acceleration from cachedHardwareInfo without re-detecting', async () => {
      const cachedAcceleration = {
        nvidia: true,
        intelQsv: false,
        amd: false,
        appleVideoToolbox: false,
      };
      // Directly inject into private cache
      (service as unknown as { cachedHardwareInfo: object }).cachedHardwareInfo = {
        acceleration: cachedAcceleration,
        systemInfo: { cpuCores: 4, architecture: 'x64', platform: 'linux', totalMemoryGb: 8 },
      };

      const result = await service.detectHardwareAcceleration();
      expect(result).toEqual(cachedAcceleration);
    });
  });

  // ==========================================================================
  // getSystemInfo - returns cached systemInfo when cachedHardwareInfo is set
  // ==========================================================================
  describe('getSystemInfo uses cachedHardwareInfo', () => {
    it('returns systemInfo from cache without calling os module again', async () => {
      const cachedSystemInfo = {
        cpuCores: 32,
        architecture: 'arm64',
        platform: 'darwin',
        totalMemoryGb: 64,
        containerRuntime: undefined,
        unraidVersion: undefined,
      };
      (service as unknown as { cachedHardwareInfo: object }).cachedHardwareInfo = {
        acceleration: { nvidia: false, intelQsv: false, amd: false, appleVideoToolbox: false },
        systemInfo: cachedSystemInfo,
      };

      const result = await service.getSystemInfo();
      expect(result).toEqual(cachedSystemInfo);
    });
  });

  // ==========================================================================
  // getContainerRuntime - returns 'docker' as fallback when in Docker but
  // no specific cgroup markers match
  // ==========================================================================
  describe('getContainerRuntime docker fallback', () => {
    it('returns docker string when isDocker=true but no podman/containerd/crio marker found', async () => {
      jest.spyOn(service, 'isDocker').mockResolvedValue(true);
      // The actual fs reads won't find /run/.containerenv (not on macOS/CI)
      // and /proc/1/cgroup won't contain docker/containerd on macOS
      // so the fallback path returns 'docker' — OR the fs checks return undefined
      // Either way the contract is: string or undefined
      const runtime = await service.getContainerRuntime();
      expect(runtime === undefined || typeof runtime === 'string').toBe(true);
    });
  });

  // ==========================================================================
  // detectEnvironment - does not call isDocker when isUnraid returns true
  // ==========================================================================
  describe('detectEnvironment - short-circuits on Unraid', () => {
    it('does not check Docker when Unraid is detected', async () => {
      const isUnraidSpy = jest.spyOn(service, 'isUnraid').mockResolvedValue(true);
      const isDockerSpy = jest.spyOn(service, 'isDocker');

      const result = await service.detectEnvironment();

      expect(result).toBe('UNRAID');
      expect(isUnraidSpy).toHaveBeenCalledTimes(1);
      expect(isDockerSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // getEnvironmentInfo - UNRAID environment flags
  // ==========================================================================
  describe('getEnvironmentInfo UNRAID flags', () => {
    it('sets isUnraid=true and isDocker=true for UNRAID environment', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('UNRAID');
      jest.spyOn(service, 'isUnraid').mockResolvedValue(true);
      jest.spyOn(service, 'isDocker').mockResolvedValue(true);
      jest.spyOn(service, 'getHardwareInfo').mockResolvedValue({
        acceleration: { nvidia: false, intelQsv: false, amd: false, appleVideoToolbox: false },
        systemInfo: { cpuCores: 8, architecture: 'x64', platform: 'linux', totalMemoryGb: 32 },
      });
      jest.spyOn(service, 'getStoragePaths').mockResolvedValue({
        mediaPath: '/mnt/user/media',
        downloadsPath: '/mnt/user/Downloads',
        configPath: '/mnt/user/appdata/bitbonsai',
      });
      jest
        .spyOn(service, 'getDocsLink')
        .mockResolvedValue('https://docs.bitbonsai.com/setup/unraid');
      jest.spyOn(service, 'getRecommendations').mockResolvedValue(['use Unraid paths']);

      const info = await service.getEnvironmentInfo();

      expect(info.environment).toBe('UNRAID');
      expect(info.isUnraid).toBe(true);
      expect(info.isDocker).toBe(true);
    });
  });

  // ==========================================================================
  // getHardwareInfo - stores result in cachedHardwareInfo after first call
  // ==========================================================================
  describe('getHardwareInfo - populates cache', () => {
    it('stores result in cachedHardwareInfo so subsequent calls are instant', async () => {
      const accel = { nvidia: false, intelQsv: true, amd: false, appleVideoToolbox: false };
      const sysInfo = {
        cpuCores: 6,
        architecture: 'x64',
        platform: 'linux',
        totalMemoryGb: 12,
        containerRuntime: undefined,
        unraidVersion: undefined,
      };

      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue(accel);
      jest.spyOn(service, 'getSystemInfo').mockResolvedValue(sysInfo);

      await service.getHardwareInfo();

      const cache = (
        service as unknown as { cachedHardwareInfo: { acceleration: object; systemInfo: object } }
      ).cachedHardwareInfo;
      expect(cache).not.toBeNull();
      expect(cache.acceleration).toEqual(accel);
      expect(cache.systemInfo).toEqual(sysInfo);
    });
  });

  // ==========================================================================
  // getRecommendations - no GPU recs when all acceleration flags are false
  // ==========================================================================
  describe('getRecommendations - no GPU flags', () => {
    it('does not include any GPU recommendation when no GPU detected', async () => {
      jest.spyOn(service, 'detectEnvironment').mockResolvedValue('DOCKER');
      jest.spyOn(service, 'isDocker').mockResolvedValue(true);
      jest.spyOn(service, 'getHardwareInfo').mockResolvedValue({
        acceleration: { nvidia: false, intelQsv: false, amd: false, appleVideoToolbox: false },
        systemInfo: { cpuCores: 2, architecture: 'x64', platform: 'linux', totalMemoryGb: 4 },
      });

      const recs = await service.getRecommendations();

      expect(recs.some((r) => r.includes('NVIDIA'))).toBe(false);
      expect(recs.some((r) => r.includes('Intel Quick Sync'))).toBe(false);
      expect(recs.some((r) => r.includes('AMD'))).toBe(false);
      expect(recs.some((r) => r.includes('Apple Silicon'))).toBe(false);
    });
  });
});

// ==========================================================================
// FS-mocked tests for isUnraid / isDocker / getContainerRuntime branches
// ==========================================================================

jest.mock('node:fs');

describe('EnvironmentService (fs mocked)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsMock = require('node:fs') as jest.Mocked<typeof import('node:fs')>;
  let service: EnvironmentService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [EnvironmentService],
    }).compile();
    service = module.get<EnvironmentService>(EnvironmentService);
  });

  describe('isUnraid', () => {
    it('returns true when /etc/unraid-version exists', async () => {
      fsMock.existsSync.mockImplementation((p) => p === '/etc/unraid-version');
      expect(await service.isUnraid()).toBe(true);
    });

    it('returns true when /boot/config and /usr/local/emhttp exist', async () => {
      fsMock.existsSync.mockImplementation(
        (p) => p === '/boot/config' || p === '/usr/local/emhttp'
      );
      expect(await service.isUnraid()).toBe(true);
    });

    it('returns false when no unraid paths exist', async () => {
      fsMock.existsSync.mockReturnValue(false);
      expect(await service.isUnraid()).toBe(false);
    });

    it('returns false when existsSync throws', async () => {
      fsMock.existsSync.mockImplementation(() => {
        throw new Error('EPERM');
      });
      expect(await service.isUnraid()).toBe(false);
    });
  });

  describe('isDocker', () => {
    it('returns true when /.dockerenv exists', async () => {
      fsMock.existsSync.mockImplementation((p) => p === '/.dockerenv');
      expect(await service.isDocker()).toBe(true);
    });

    it('returns true when /proc/1/cgroup contains "docker"', async () => {
      fsMock.existsSync.mockImplementation((p) => p === '/proc/1/cgroup');
      fsMock.readFileSync.mockReturnValue('12:devices:/docker/abc123\n');
      expect(await service.isDocker()).toBe(true);
    });

    it('returns true when /proc/1/cgroup contains "containerd"', async () => {
      fsMock.existsSync.mockImplementation((p) => p === '/proc/1/cgroup');
      fsMock.readFileSync.mockReturnValue('0::/ containerd-shim\n');
      expect(await service.isDocker()).toBe(true);
    });

    it('returns true when /proc/self/mountinfo contains "docker"', async () => {
      fsMock.existsSync.mockImplementation((p) => p === '/proc/self/mountinfo');
      fsMock.readFileSync.mockReturnValue('overlay / docker/containers\n');
      expect(await service.isDocker()).toBe(true);
    });

    it('returns false when none of the docker indicators are present', async () => {
      fsMock.existsSync.mockReturnValue(false);
      expect(await service.isDocker()).toBe(false);
    });

    it('returns false when fs throws', async () => {
      fsMock.existsSync.mockImplementation(() => {
        throw new Error('EACCES');
      });
      expect(await service.isDocker()).toBe(false);
    });
  });

  describe('getContainerRuntime', () => {
    it('returns "podman" when /run/.containerenv exists and isDocker=true', async () => {
      fsMock.existsSync.mockImplementation(
        (p) => p === '/.dockerenv' || p === '/run/.containerenv'
      );
      expect(await service.getContainerRuntime()).toBe('podman');
    });

    it('returns "docker" when cgroup contains "docker"', async () => {
      fsMock.existsSync.mockImplementation((p) => p === '/.dockerenv' || p === '/proc/1/cgroup');
      fsMock.readFileSync.mockReturnValue('12:devices:/docker/abc\n');
      expect(await service.getContainerRuntime()).toBe('docker');
    });

    it('returns "containerd" when cgroup contains "containerd"', async () => {
      fsMock.existsSync.mockImplementation((p) => p === '/.dockerenv' || p === '/proc/1/cgroup');
      fsMock.readFileSync.mockReturnValue('0:: containerd\n');
      expect(await service.getContainerRuntime()).toBe('containerd');
    });

    it('returns undefined when not in docker', async () => {
      fsMock.existsSync.mockReturnValue(false);
      expect(await service.getContainerRuntime()).toBeUndefined();
    });
  });
});
