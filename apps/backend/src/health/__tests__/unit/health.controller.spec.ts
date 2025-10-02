import { ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let service: HealthService;

  const mockHealthService = {
    getBasicHealth: jest.fn(),
    getDetailedHealth: jest.fn(),
    isReady: jest.fn(),
    isLive: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: mockHealthService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    service = module.get<HealthService>(HealthService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHealth', () => {
    it('should return basic health information', async () => {
      const expectedResult = {
        status: 'ok' as const,
        timestamp: new Date(),
        uptime: 3600,
        version: '0.1.0',
      };

      mockHealthService.getBasicHealth.mockResolvedValue(expectedResult);

      const result = await controller.getHealth();

      expect(result).toEqual(expectedResult);
      expect(mockHealthService.getBasicHealth).toHaveBeenCalled();
    });

    it('should return error status when unhealthy', async () => {
      const expectedResult = {
        status: 'error' as const,
        timestamp: new Date(),
        uptime: 3600,
        version: '0.1.0',
      };

      mockHealthService.getBasicHealth.mockResolvedValue(expectedResult);

      const result = await controller.getHealth();

      expect(result.status).toBe('error');
      expect(mockHealthService.getBasicHealth).toHaveBeenCalled();
    });
  });

  describe('getDetailedHealth', () => {
    it('should return detailed health information', async () => {
      const expectedResult = {
        status: 'ok' as const,
        timestamp: new Date(),
        checks: {
          database: { status: 'ok' as const, responseTime: 15 },
          redis: undefined,
          disk: {
            status: 'ok' as const,
            used: '50%',
            available: '500GB',
          },
          memory: {
            status: 'ok' as const,
            used: '2GB',
            total: '16GB',
            percentage: 12.5,
          },
          ffmpeg: {
            status: 'ok' as const,
            responseTime: 50,
            version: '5.1.2',
          },
        },
        nodes: {
          total: 2,
          online: 2,
          offline: 0,
        },
        queue: {
          queued: 5,
          encoding: 2,
          completed: 150,
          failed: 3,
        },
      };

      mockHealthService.getDetailedHealth.mockResolvedValue(expectedResult);

      const result = await controller.getDetailedHealth();

      expect(result).toEqual(expectedResult);
      expect(mockHealthService.getDetailedHealth).toHaveBeenCalled();
    });

    it('should return degraded status when some services are down', async () => {
      const expectedResult = {
        status: 'degraded' as const,
        timestamp: new Date(),
        checks: {
          database: { status: 'ok' as const, responseTime: 15 },
          redis: { status: 'error' as const, error: 'Connection refused' },
          disk: {
            status: 'warning' as const,
            used: '85%',
            available: '150GB',
          },
          memory: {
            status: 'ok' as const,
            used: '2GB',
            total: '16GB',
            percentage: 12.5,
          },
          ffmpeg: {
            status: 'ok' as const,
            responseTime: 50,
            version: '5.1.2',
          },
        },
        nodes: {
          total: 2,
          online: 1,
          offline: 1,
        },
        queue: {
          queued: 5,
          encoding: 2,
          completed: 150,
          failed: 3,
        },
      };

      mockHealthService.getDetailedHealth.mockResolvedValue(expectedResult);

      const result = await controller.getDetailedHealth();

      expect(result.status).toBe('degraded');
      expect(mockHealthService.getDetailedHealth).toHaveBeenCalled();
    });

    it('should return error status when database is down', async () => {
      const expectedResult = {
        status: 'error' as const,
        timestamp: new Date(),
        checks: {
          database: { status: 'error' as const, error: 'Connection failed' },
          redis: undefined,
          disk: {
            status: 'ok' as const,
            used: '50%',
            available: '500GB',
          },
          memory: {
            status: 'ok' as const,
            used: '2GB',
            total: '16GB',
            percentage: 12.5,
          },
          ffmpeg: {
            status: 'ok' as const,
            responseTime: 50,
            version: '5.1.2',
          },
        },
        nodes: {
          total: 0,
          online: 0,
          offline: 0,
        },
        queue: {
          queued: 0,
          encoding: 0,
          completed: 0,
          failed: 0,
        },
      };

      mockHealthService.getDetailedHealth.mockResolvedValue(expectedResult);

      const result = await controller.getDetailedHealth();

      expect(result.status).toBe('error');
      expect(mockHealthService.getDetailedHealth).toHaveBeenCalled();
    });
  });

  describe('getReadiness', () => {
    it('should return ready when application is ready', async () => {
      const expectedResult = {
        ready: true,
      };

      mockHealthService.isReady.mockResolvedValue(expectedResult);

      const result = await controller.getReadiness();

      expect(result.ready).toBe(true);
      expect(mockHealthService.isReady).toHaveBeenCalled();
    });

    it('should throw ServiceUnavailableException when not ready', async () => {
      const expectedResult = {
        ready: false,
        reason: 'Database connection failed',
      };

      mockHealthService.isReady.mockResolvedValue(expectedResult);

      await expect(controller.getReadiness()).rejects.toThrow(ServiceUnavailableException);
      expect(mockHealthService.isReady).toHaveBeenCalled();
    });
  });

  describe('getLiveness', () => {
    it('should return alive when application is alive', async () => {
      const expectedResult = {
        alive: true,
      };

      mockHealthService.isLive.mockResolvedValue(expectedResult);

      const result = await controller.getLiveness();

      expect(result.alive).toBe(true);
      expect(mockHealthService.isLive).toHaveBeenCalled();
    });

    it('should throw ServiceUnavailableException when not alive', async () => {
      const expectedResult = {
        alive: false,
      };

      mockHealthService.isLive.mockResolvedValue(expectedResult);

      await expect(controller.getLiveness()).rejects.toThrow(ServiceUnavailableException);
      expect(mockHealthService.isLive).toHaveBeenCalled();
    });
  });
});
