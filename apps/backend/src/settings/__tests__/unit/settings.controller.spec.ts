import { Test, type TestingModule } from '@nestjs/testing';
import type { EnvironmentInfoDto } from '../../../common/dto/environment-info.dto';
import { EnvironmentService } from '../../../common/environment.service';
import { SettingsController } from '../../settings.controller';

describe('SettingsController', () => {
  let controller: SettingsController;
  let environmentService: EnvironmentService;

  const mockEnvironmentInfo: EnvironmentInfoDto = {
    environment: 'UNRAID',
    isUnraid: true,
    isDocker: true,
    hardwareAcceleration: {
      nvidia: true,
      intelQsv: false,
      amd: false,
      appleVideoToolbox: false,
    },
    defaultPaths: {
      mediaPath: '/mnt/user/media',
      downloadsPath: '/mnt/user/Downloads',
      configPath: '/mnt/user/appdata/bitbonsai',
    },
    systemInfo: {
      cpuCores: 8,
      architecture: 'x64',
      platform: 'linux',
      totalMemoryGb: 32,
      containerRuntime: 'docker',
      unraidVersion: '6.12.4',
    },
    docsLink: 'https://docs.bitbonsai.com/setup/unraid',
    recommendations: [
      'Use /mnt/user paths for Unraid array storage',
      'NVIDIA GPU detected - hardware acceleration available',
    ],
  };

  beforeEach(async () => {
    const mockEnvironmentService = {
      getEnvironmentInfo: jest.fn().mockResolvedValue(mockEnvironmentInfo),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        {
          provide: EnvironmentService,
          useValue: mockEnvironmentService,
        },
      ],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
    environmentService = module.get<EnvironmentService>(EnvironmentService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getEnvironmentInfo', () => {
    it('should return environment information', async () => {
      const result = await controller.getEnvironmentInfo();

      expect(result).toEqual(mockEnvironmentInfo);
      expect(environmentService.getEnvironmentInfo).toHaveBeenCalledTimes(1);
    });

    it('should detect Unraid environment correctly', async () => {
      const result = await controller.getEnvironmentInfo();

      expect(result.environment).toBe('UNRAID');
      expect(result.isUnraid).toBe(true);
      expect(result.isDocker).toBe(true);
    });

    it('should include hardware acceleration info', async () => {
      const result = await controller.getEnvironmentInfo();

      expect(result.hardwareAcceleration).toBeDefined();
      expect(result.hardwareAcceleration.nvidia).toBe(true);
    });

    it('should include default paths', async () => {
      const result = await controller.getEnvironmentInfo();

      expect(result.defaultPaths).toBeDefined();
      expect(result.defaultPaths.mediaPath).toBe('/mnt/user/media');
    });

    it('should include system info', async () => {
      const result = await controller.getEnvironmentInfo();

      expect(result.systemInfo).toBeDefined();
      expect(result.systemInfo.cpuCores).toBe(8);
      expect(result.systemInfo.totalMemoryGb).toBe(32);
    });

    it('should include recommendations', async () => {
      const result = await controller.getEnvironmentInfo();

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('should include docs link', async () => {
      const result = await controller.getEnvironmentInfo();

      expect(result.docsLink).toBeDefined();
      expect(result.docsLink).toBe('https://docs.bitbonsai.com/setup/unraid');
    });
  });

  describe('Docker environment', () => {
    it('should detect Docker environment (non-Unraid)', async () => {
      const dockerEnvironment: EnvironmentInfoDto = {
        ...mockEnvironmentInfo,
        environment: 'DOCKER',
        isUnraid: false,
        isDocker: true,
        defaultPaths: {
          mediaPath: '/library',
          downloadsPath: '/downloads',
          configPath: '/config',
        },
        systemInfo: {
          ...mockEnvironmentInfo.systemInfo,
          unraidVersion: undefined,
          containerRuntime: 'containerd',
        },
        docsLink: 'https://docs.bitbonsai.com/setup/docker',
      };

      jest.spyOn(environmentService, 'getEnvironmentInfo').mockResolvedValue(dockerEnvironment);

      const result = await controller.getEnvironmentInfo();

      expect(result.environment).toBe('DOCKER');
      expect(result.isUnraid).toBe(false);
      expect(result.defaultPaths.mediaPath).toBe('/library');
    });
  });

  describe('Bare Metal environment', () => {
    it('should detect bare metal environment', async () => {
      const bareMetalEnvironment: EnvironmentInfoDto = {
        ...mockEnvironmentInfo,
        environment: 'BARE_METAL',
        isUnraid: false,
        isDocker: false,
        defaultPaths: {
          mediaPath: '/var/lib/bitbonsai/media',
          downloadsPath: '/var/lib/bitbonsai/downloads',
          configPath: '/etc/bitbonsai',
        },
        systemInfo: {
          ...mockEnvironmentInfo.systemInfo,
          unraidVersion: undefined,
          containerRuntime: undefined,
        },
        docsLink: 'https://docs.bitbonsai.com/setup/installation',
      };

      jest.spyOn(environmentService, 'getEnvironmentInfo').mockResolvedValue(bareMetalEnvironment);

      const result = await controller.getEnvironmentInfo();

      expect(result.environment).toBe('BARE_METAL');
      expect(result.isUnraid).toBe(false);
      expect(result.isDocker).toBe(false);
    });
  });
});
