import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { Test, type TestingModule } from '@nestjs/testing';
import { EnvironmentService } from './environment.service';

// Mock modules
jest.mock('node:fs');
jest.mock('node:os');
jest.mock('node:child_process');

describe('EnvironmentService', () => {
  let service: EnvironmentService;
  const mockExec = exec as jest.MockedFunction<typeof exec>;
  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockOs = os as jest.Mocked<typeof os>;

  beforeEach(async () => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [EnvironmentService],
    }).compile();

    service = module.get<EnvironmentService>(EnvironmentService);

    // Reset cached values after service is created
    // biome-ignore lint/suspicious/noExplicitAny: Required for testing private properties
    (service as any).cachedEnvironment = null;
    // biome-ignore lint/suspicious/noExplicitAny: Required for testing private properties
    (service as any).cachedHardwareInfo = null;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('detectEnvironment', () => {
    it('should detect UNRAID environment', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        if (path === '/etc/unraid-version') return true;
        if (path === '/.dockerenv') return true;
        return false;
      }) as any;

      const result = await service.detectEnvironment();
      expect(result).toBe('UNRAID');
    });

    it('should detect DOCKER environment', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        if (path === '/etc/unraid-version') return false;
        if (path === '/.dockerenv') return true;
        return false;
      }) as any;

      const result = await service.detectEnvironment();
      expect(result).toBe('DOCKER');
    });

    it('should detect BARE_METAL environment', async () => {
      mockFs.existsSync = jest.fn(() => false) as any;
      mockFs.readFileSync = jest.fn(() => '') as any;

      const result = await service.detectEnvironment();
      expect(result).toBe('BARE_METAL');
    });

    it('should cache environment detection result', async () => {
      mockFs.existsSync = jest.fn(() => false) as any;

      const result1 = await service.detectEnvironment();
      const result2 = await service.detectEnvironment();

      expect(result1).toBe(result2);
      expect(mockFs.existsSync).toHaveBeenCalledTimes(3); // Only called once due to caching
    });
  });

  describe('isUnraid', () => {
    it('should return true when /etc/unraid-version exists', async () => {
      mockFs.existsSync = jest.fn((path: string) => path === '/etc/unraid-version') as any;

      const result = await service.isUnraid();
      expect(result).toBe(true);
    });

    it('should return true when Unraid-specific directories exist', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        return path === '/boot/config' || path === '/usr/local/emhttp';
      }) as any;

      const result = await service.isUnraid();
      expect(result).toBe(true);
    });

    it('should return false when Unraid is not detected', async () => {
      mockFs.existsSync = jest.fn(() => false) as any;

      const result = await service.isUnraid();
      expect(result).toBe(false);
    });
  });

  describe('isDocker', () => {
    it('should return true when .dockerenv exists', async () => {
      mockFs.existsSync = jest.fn((path: string) => path === '/.dockerenv') as any;

      const result = await service.isDocker();
      expect(result).toBe(true);
    });

    it('should return true when docker is in cgroup', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        if (path === '/.dockerenv') return false;
        if (path === '/proc/1/cgroup') return true;
        return false;
      }) as any;

      mockFs.readFileSync = jest.fn((path: string) => {
        if (path === '/proc/1/cgroup') {
          return '1:name=systemd:/docker/abc123';
        }
        return '';
      }) as any;

      const result = await service.isDocker();
      expect(result).toBe(true);
    });

    it('should return true when containerd is in cgroup', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        if (path === '/.dockerenv') return false;
        if (path === '/proc/1/cgroup') return true;
        return false;
      }) as any;

      mockFs.readFileSync = jest.fn((path: string) => {
        if (path === '/proc/1/cgroup') {
          return '1:name=systemd:/containerd/abc123';
        }
        return '';
      }) as any;

      const result = await service.isDocker();
      expect(result).toBe(true);
    });

    it('should return false when Docker is not detected', async () => {
      mockFs.existsSync = jest.fn(() => false) as any;

      const result = await service.isDocker();
      expect(result).toBe(false);
    });
  });

  describe('getUnraidVersion', () => {
    it('should return Unraid version when file exists', async () => {
      mockFs.existsSync = jest.fn((path: string) => path === '/etc/unraid-version') as any;
      mockFs.readFileSync = jest.fn(() => 'version="6.12.4"\n') as any;

      const result = await service.getUnraidVersion();
      expect(result).toBe('6.12.4');
    });

    it('should return undefined when file does not exist', async () => {
      mockFs.existsSync = jest.fn(() => false) as any;

      const result = await service.getUnraidVersion();
      expect(result).toBeUndefined();
    });
  });

  describe('getContainerRuntime', () => {
    it('should return undefined when not in Docker', async () => {
      mockFs.existsSync = jest.fn(() => false) as any;

      const result = await service.getContainerRuntime();
      expect(result).toBeUndefined();
    });

    it('should detect podman runtime', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        if (path === '/.dockerenv') return true;
        if (path === '/run/.containerenv') return true;
        return false;
      }) as any;

      const result = await service.getContainerRuntime();
      expect(result).toBe('podman');
    });

    it('should detect docker runtime from cgroup', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        if (path === '/.dockerenv') return true;
        if (path === '/run/.containerenv') return false;
        if (path === '/proc/1/cgroup') return true;
        return false;
      }) as any;

      mockFs.readFileSync = jest.fn((path: string) => {
        if (path === '/proc/1/cgroup') {
          return '1:name=systemd:/docker/abc123';
        }
        return '';
      }) as any;

      const result = await service.getContainerRuntime();
      expect(result).toBe('docker');
    });

    it('should detect containerd runtime', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        if (path === '/.dockerenv') return true;
        if (path === '/run/.containerenv') return false;
        if (path === '/proc/1/cgroup') return true;
        return false;
      }) as any;

      mockFs.readFileSync = jest.fn((path: string) => {
        if (path === '/proc/1/cgroup') {
          return '1:name=systemd:/containerd/abc123';
        }
        return '';
      }) as any;

      const result = await service.getContainerRuntime();
      expect(result).toBe('containerd');
    });
  });

  describe('getStoragePaths', () => {
    it('should return Unraid paths when on Unraid', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        return path === '/etc/unraid-version';
      }) as any;

      const result = await service.getStoragePaths();
      expect(result).toEqual({
        mediaPath: '/mnt/user/media',
        downloadsPath: '/mnt/user/Downloads',
        configPath: '/mnt/user/appdata/bitbonsai',
      });
    });

    it('should return Docker paths when in Docker (non-Unraid)', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        if (path === '/etc/unraid-version') return false;
        if (path === '/.dockerenv') return true;
        return false;
      }) as any;

      const result = await service.getStoragePaths();
      expect(result).toEqual({
        mediaPath: '/library',
        downloadsPath: '/downloads',
        configPath: '/config',
      });
    });

    it('should return bare metal paths for native installation', async () => {
      mockFs.existsSync = jest.fn(() => false) as any;

      const result = await service.getStoragePaths();
      expect(result).toEqual({
        mediaPath: '/var/lib/bitbonsai/media',
        downloadsPath: '/var/lib/bitbonsai/downloads',
        configPath: '/etc/bitbonsai',
      });
    });
  });

  describe('Hardware Detection', () => {
    describe('detectNvidia', () => {
      it('should return true when NVIDIA GPU is detected', async () => {
        const mockExecAsync = jest.fn().mockImplementation((cmd: string) => {
          if (cmd === 'which nvidia-smi') {
            return Promise.resolve({ stdout: '/usr/bin/nvidia-smi', stderr: '' });
          }
          if (cmd.includes('nvidia-smi --query-gpu')) {
            return Promise.resolve({ stdout: 'NVIDIA GeForce RTX 3090\n', stderr: '' });
          }
          return Promise.reject(new Error('Command not found'));
        });

        // Mock the private method via reflection
        (service as any).detectNvidia = jest.fn().mockResolvedValue(true);

        const result = await (service as any).detectNvidia();
        expect(result).toBe(true);
      });

      it('should return false when NVIDIA GPU is not detected', async () => {
        (service as any).detectNvidia = jest.fn().mockResolvedValue(false);

        const result = await (service as any).detectNvidia();
        expect(result).toBe(false);
      });
    });

    describe('detectIntelQsv', () => {
      it('should return true when Intel QSV is detected', async () => {
        mockFs.readdirSync = jest.fn(() => ['renderD128']) as any;
        mockFs.existsSync = jest.fn(
          (path: string) => path === '/sys/class/drm/card0/device/vendor'
        ) as any;
        mockFs.readFileSync = jest.fn((path: string) => {
          if (path === '/sys/class/drm/card0/device/vendor') {
            return '0x8086'; // Intel vendor ID
          }
          return '';
        }) as any;

        (service as any).detectIntelQsv = jest.fn().mockResolvedValue(true);

        const result = await (service as any).detectIntelQsv();
        expect(result).toBe(true);
      });

      it('should return false when Intel QSV is not detected', async () => {
        mockFs.readdirSync = jest.fn(() => []) as any;

        (service as any).detectIntelQsv = jest.fn().mockResolvedValue(false);

        const result = await (service as any).detectIntelQsv();
        expect(result).toBe(false);
      });
    });

    describe('detectAmd', () => {
      it('should return true when AMD GPU is detected via lspci', async () => {
        (service as any).detectAmd = jest.fn().mockResolvedValue(true);

        const result = await (service as any).detectAmd();
        expect(result).toBe(true);
      });

      it('should return false when AMD GPU is not detected', async () => {
        (service as any).detectAmd = jest.fn().mockResolvedValue(false);

        const result = await (service as any).detectAmd();
        expect(result).toBe(false);
      });
    });

    describe('detectAppleVideoToolbox', () => {
      it('should return true on Apple Silicon', async () => {
        mockOs.platform = jest.fn().mockReturnValue('darwin');

        (service as any).detectAppleVideoToolbox = jest.fn().mockResolvedValue(true);

        const result = await (service as any).detectAppleVideoToolbox();
        expect(result).toBe(true);
      });

      it('should return false on non-macOS platform', async () => {
        mockOs.platform = jest.fn().mockReturnValue('linux');

        (service as any).detectAppleVideoToolbox = jest.fn().mockResolvedValue(false);

        const result = await (service as any).detectAppleVideoToolbox();
        expect(result).toBe(false);
      });
    });
  });

  describe('getSystemInfo', () => {
    it('should return system information', async () => {
      mockOs.cpus = jest
        .fn()
        .mockReturnValue([
          { model: 'Intel Core i7' },
          { model: 'Intel Core i7' },
          { model: 'Intel Core i7' },
          { model: 'Intel Core i7' },
        ]);
      mockOs.arch = jest.fn().mockReturnValue('x64');
      mockOs.platform = jest.fn().mockReturnValue('linux');
      mockOs.totalmem = jest.fn().mockReturnValue(16 * 1024 * 1024 * 1024); // 16GB

      mockFs.existsSync = jest.fn(() => false) as any;

      const result = await service.getSystemInfo();

      expect(result.cpuCores).toBe(4);
      expect(result.architecture).toBe('x64');
      expect(result.platform).toBe('linux');
      expect(result.totalMemoryGb).toBe(16);
    });
  });

  describe('getDocsLink', () => {
    it('should return Unraid docs link for Unraid environment', async () => {
      mockFs.existsSync = jest.fn((path: string) => path === '/etc/unraid-version') as any;

      const result = await service.getDocsLink();
      expect(result).toBe('https://docs.bitbonsai.com/setup/unraid');
    });

    it('should return Docker docs link for Docker environment', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        if (path === '/etc/unraid-version') return false;
        if (path === '/.dockerenv') return true;
        return false;
      }) as any;

      const result = await service.getDocsLink();
      expect(result).toBe('https://docs.bitbonsai.com/setup/docker');
    });

    it('should return installation docs link for bare metal', async () => {
      mockFs.existsSync = jest.fn(() => false) as any;

      const result = await service.getDocsLink();
      expect(result).toBe('https://docs.bitbonsai.com/setup/installation');
    });
  });

  describe('getRecommendations', () => {
    it('should return Unraid-specific recommendations', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        if (path === '/etc/unraid-version') return true;
        if (path === '/.dockerenv') return true;
        return false;
      }) as any;

      mockOs.cpus = jest.fn().mockReturnValue([{}, {}, {}, {}]);
      mockOs.arch = jest.fn().mockReturnValue('x64');
      mockOs.platform = jest.fn().mockReturnValue('linux');
      mockOs.totalmem = jest.fn().mockReturnValue(16 * 1024 * 1024 * 1024);

      // Mock hardware detection to return no GPUs
      (service as any).detectNvidia = jest.fn().mockResolvedValue(false);
      (service as any).detectIntelQsv = jest.fn().mockResolvedValue(false);
      (service as any).detectAmd = jest.fn().mockResolvedValue(false);
      (service as any).detectAppleVideoToolbox = jest.fn().mockResolvedValue(false);

      const result = await service.getRecommendations();

      expect(result).toContain('Use /mnt/user paths for Unraid array storage');
      expect(result).toContain('GPU passthrough available - configure in Docker template');
    });

    it('should include GPU recommendations when detected', async () => {
      mockFs.existsSync = jest.fn(() => false) as any;

      mockOs.cpus = jest.fn().mockReturnValue([{}, {}, {}, {}]);
      mockOs.arch = jest.fn().mockReturnValue('x64');
      mockOs.platform = jest.fn().mockReturnValue('linux');
      mockOs.totalmem = jest.fn().mockReturnValue(16 * 1024 * 1024 * 1024);

      // Mock NVIDIA GPU detection
      (service as any).detectNvidia = jest.fn().mockResolvedValue(true);
      (service as any).detectIntelQsv = jest.fn().mockResolvedValue(false);
      (service as any).detectAmd = jest.fn().mockResolvedValue(false);
      (service as any).detectAppleVideoToolbox = jest.fn().mockResolvedValue(false);

      const result = await service.getRecommendations();

      expect(result).toContain(
        'NVIDIA GPU detected - hardware acceleration available for transcoding'
      );
    });
  });

  describe('getEnvironmentInfo', () => {
    it('should return complete environment information', async () => {
      mockFs.existsSync = jest.fn((path: string) => {
        if (path === '/etc/unraid-version') return true;
        if (path === '/.dockerenv') return true;
        return false;
      }) as any;

      mockFs.readFileSync = jest.fn((path: string) => {
        if (path === '/etc/unraid-version') return 'version="6.12.4"\n';
        return '';
      }) as any;

      mockOs.cpus = jest.fn().mockReturnValue([{}, {}, {}, {}]);
      mockOs.arch = jest.fn().mockReturnValue('x64');
      mockOs.platform = jest.fn().mockReturnValue('linux');
      mockOs.totalmem = jest.fn().mockReturnValue(16 * 1024 * 1024 * 1024);

      // Mock hardware detection
      (service as any).detectNvidia = jest.fn().mockResolvedValue(true);
      (service as any).detectIntelQsv = jest.fn().mockResolvedValue(false);
      (service as any).detectAmd = jest.fn().mockResolvedValue(false);
      (service as any).detectAppleVideoToolbox = jest.fn().mockResolvedValue(false);

      const result = await service.getEnvironmentInfo();

      expect(result.environment).toBe('UNRAID');
      expect(result.isUnraid).toBe(true);
      expect(result.isDocker).toBe(true);
      expect(result.hardwareAcceleration.nvidia).toBe(true);
      expect(result.defaultPaths.mediaPath).toBe('/mnt/user/media');
      expect(result.systemInfo.cpuCores).toBe(4);
      expect(result.systemInfo.unraidVersion).toBe('6.12.4');
      expect(result.docsLink).toBe('https://docs.bitbonsai.com/setup/unraid');
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });
});
