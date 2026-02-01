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

      expect(result).toBeDefined();
      expect(result.mediaPath).toBeDefined();
      expect(result.downloadsPath).toBeDefined();
      expect(result.configPath).toBeDefined();
      expect(typeof result.mediaPath).toBe('string');
      expect(typeof result.downloadsPath).toBe('string');
      expect(typeof result.configPath).toBe('string');
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

      expect(result).toBeDefined();
      expect(typeof result.nvidia).toBe('boolean');
      expect(typeof result.intelQsv).toBe('boolean');
      expect(typeof result.amd).toBe('boolean');
      expect(typeof result.appleVideoToolbox).toBe('boolean');
    });
  });

  describe('getSystemInfo', () => {
    it('should return system information', async () => {
      const result = await service.getSystemInfo();

      expect(result).toBeDefined();
      expect(result.cpuCores).toBeGreaterThan(0);
      expect(result.architecture).toBeDefined();
      expect(result.platform).toBeDefined();
      expect(result.totalMemoryGb).toBeGreaterThan(0);
      expect(['string', 'undefined']).toContain(typeof result.containerRuntime);
      expect(['string', 'undefined']).toContain(typeof result.unraidVersion);
    });
  });

  describe('getHardwareInfo', () => {
    it('should return complete hardware info with caching', async () => {
      const result1 = await service.getHardwareInfo();
      const result2 = await service.getHardwareInfo();

      expect(result1).toBeDefined();
      expect(result1.acceleration).toBeDefined();
      expect(result1.systemInfo).toBeDefined();
      expect(result1).toBe(result2); // Should return same cached object
    });
  });

  describe('getDocsLink', () => {
    it('should return appropriate docs link', async () => {
      const environment = await service.detectEnvironment();
      const docsLink = await service.getDocsLink();

      expect(docsLink).toBeDefined();
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

      expect(result).toBeDefined();
      expect(['UNRAID', 'DOCKER', 'BARE_METAL']).toContain(result.environment);
      expect(typeof result.isUnraid).toBe('boolean');
      expect(typeof result.isDocker).toBe('boolean');
      expect(result.hardwareAcceleration).toBeDefined();
      expect(result.defaultPaths).toBeDefined();
      expect(result.systemInfo).toBeDefined();
      expect(result.docsLink).toBeDefined();
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
      expect(result.hardwareAcceleration.nvidia).toBeDefined();
      expect(result.hardwareAcceleration.intelQsv).toBeDefined();
      expect(result.hardwareAcceleration.amd).toBeDefined();
      expect(result.hardwareAcceleration.appleVideoToolbox).toBeDefined();

      expect(result.defaultPaths.mediaPath).toBeDefined();
      expect(result.defaultPaths.downloadsPath).toBeDefined();
      expect(result.defaultPaths.configPath).toBeDefined();

      expect(result.systemInfo.cpuCores).toBeDefined();
      expect(result.systemInfo.architecture).toBeDefined();
      expect(result.systemInfo.platform).toBeDefined();
      expect(result.systemInfo.totalMemoryGb).toBeDefined();
    });
  });
});
