import { ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { HealthController } from '../../health.controller';
import { HealthService } from '../../health.service';

describe('HealthController', () => {
  let controller: HealthController;

  const mockHealthService = {
    getBasicHealth: jest.fn(),
    getDetailedHealth: jest.fn(),
    monitorLibraryDiskSpace: jest.fn(),
    isReady: jest.fn(),
    isLive: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: mockHealthService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHealth', () => {
    it('should return basic health from service', async () => {
      const result = {
        status: 'ok',
        timestamp: '2025-01-01T00:00:00Z',
        uptime: 3600,
        version: '1.0.0',
      };
      mockHealthService.getBasicHealth.mockResolvedValue(result);

      const response = await controller.getHealth();

      expect(mockHealthService.getBasicHealth).toHaveBeenCalledTimes(1);
      expect(response).toEqual(result);
    });

    it('should propagate service errors', async () => {
      mockHealthService.getBasicHealth.mockRejectedValue(new Error('db error'));
      await expect(controller.getHealth()).rejects.toThrow('db error');
    });
  });

  describe('getDetailedHealth', () => {
    it('should return detailed health from service', async () => {
      const result = {
        status: 'ok',
        timestamp: '2025-01-01T00:00:00Z',
        checks: {},
        nodes: {},
        queue: {},
      };
      mockHealthService.getDetailedHealth.mockResolvedValue(result);

      const response = await controller.getDetailedHealth();

      expect(mockHealthService.getDetailedHealth).toHaveBeenCalledTimes(1);
      expect(response).toEqual(result);
    });

    it('should propagate service errors', async () => {
      mockHealthService.getDetailedHealth.mockRejectedValue(new Error('service fail'));
      await expect(controller.getDetailedHealth()).rejects.toThrow('service fail');
    });
  });

  describe('getDiskSpaceMonitoring', () => {
    it('should return disk space monitoring data', async () => {
      const result = {
        overallStatus: 'ok',
        timestamp: '2025-01-01T00:00:00Z',
        libraries: [],
        globalWarnings: [],
      };
      mockHealthService.monitorLibraryDiskSpace.mockResolvedValue(result);

      const response = await controller.getDiskSpaceMonitoring();

      expect(mockHealthService.monitorLibraryDiskSpace).toHaveBeenCalledTimes(1);
      expect(response).toEqual(result);
    });

    it('should propagate service errors', async () => {
      mockHealthService.monitorLibraryDiskSpace.mockRejectedValue(new Error('disk error'));
      await expect(controller.getDiskSpaceMonitoring()).rejects.toThrow('disk error');
    });
  });

  describe('getReadiness', () => {
    it('should return readiness when service reports ready', async () => {
      const result = { ready: true };
      mockHealthService.isReady.mockResolvedValue(result);

      const response = await controller.getReadiness();

      expect(mockHealthService.isReady).toHaveBeenCalledTimes(1);
      expect(response).toEqual(result);
    });

    it('should throw ServiceUnavailableException when not ready', async () => {
      const result = { ready: false, reason: 'Database connection failed' };
      mockHealthService.isReady.mockResolvedValue(result);

      await expect(controller.getReadiness()).rejects.toThrow(ServiceUnavailableException);
    });

    it('should propagate service errors', async () => {
      mockHealthService.isReady.mockRejectedValue(new Error('check failed'));
      await expect(controller.getReadiness()).rejects.toThrow('check failed');
    });
  });

  describe('getLiveness', () => {
    it('should return liveness when service reports alive', async () => {
      const result = { alive: true };
      mockHealthService.isLive.mockResolvedValue(result);

      const response = await controller.getLiveness();

      expect(mockHealthService.isLive).toHaveBeenCalledTimes(1);
      expect(response).toEqual(result);
    });

    it('should throw ServiceUnavailableException when not alive', async () => {
      const result = { alive: false };
      mockHealthService.isLive.mockResolvedValue(result);

      await expect(controller.getLiveness()).rejects.toThrow(ServiceUnavailableException);
    });

    it('should propagate service errors', async () => {
      mockHealthService.isLive.mockRejectedValue(new Error('liveness fail'));
      await expect(controller.getLiveness()).rejects.toThrow('liveness fail');
    });
  });

  describe('ping', () => {
    it('should return "Ok"', async () => {
      const response = await controller.ping();
      expect(response).toBe('Ok');
    });
  });
});
