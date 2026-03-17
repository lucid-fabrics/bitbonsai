import { Test, type TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { DashboardController } from '../../dashboard.controller';
import { HealthDashboardService } from '../../health-dashboard.service';

describe('DashboardController', () => {
  let controller: DashboardController;

  const mockDashboardService = {
    getDashboard: jest.fn(),
    runHealthChecks: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: HealthDashboardService, useValue: mockDashboardService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DashboardController>(DashboardController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getDashboard', () => {
    it('should return dashboard data from service', async () => {
      const dashboardData = {
        timestamp: new Date().toISOString(),
        overallStatus: 'HEALTHY',
        checks: [{ name: 'cpu', status: 'PASS' }],
        system: { platform: 'linux', hostname: 'main-node' },
        queue: { total: 10, activeWorkers: 2 },
        storage: [],
        nodes: { total: 2, online: 2, offline: 0 },
        encoding: { totalProcessed: 100 },
        hardware: { cpuCores: 8 },
      };
      mockDashboardService.getDashboard.mockResolvedValue(dashboardData);

      const result = await controller.getDashboard();

      expect(result).toEqual(dashboardData);
      expect(mockDashboardService.getDashboard).toHaveBeenCalledTimes(1);
    });

    it('should propagate service errors', async () => {
      mockDashboardService.getDashboard.mockRejectedValue(new Error('DB unavailable'));

      await expect(controller.getDashboard()).rejects.toThrow('DB unavailable');
    });
  });

  describe('getHealthChecks', () => {
    it('should return health check results', async () => {
      const checks = [
        { name: 'cpu', status: 'PASS', value: 25, threshold: 90 },
        { name: 'memory', status: 'WARN', value: 80, threshold: 85 },
      ];
      mockDashboardService.runHealthChecks.mockResolvedValue(checks);

      const result = await controller.getHealthChecks();

      expect(result).toEqual(checks);
      expect(mockDashboardService.runHealthChecks).toHaveBeenCalledTimes(1);
    });

    it('should propagate service errors', async () => {
      mockDashboardService.runHealthChecks.mockRejectedValue(new Error('Check failed'));

      await expect(controller.getHealthChecks()).rejects.toThrow('Check failed');
    });
  });
});
