import { Test, type TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { DebugController } from '../../debug.controller';
import { DebugService } from '../../debug.service';

describe('DebugController', () => {
  let controller: DebugController;

  const mockDebugService = {
    getSystemLoad: jest.fn(),
    getFfmpegProcesses: jest.fn(),
    killProcessByPid: jest.fn(),
    killAllZombies: jest.fn(),
    updateLoadThreshold: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DebugController],
      providers: [{ provide: DebugService, useValue: mockDebugService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DebugController>(DebugController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSystemLoad', () => {
    it('should return system load info', async () => {
      const loadInfo = {
        cpuLoad: [1.5, 2.0, 1.8],
        memoryUsage: { total: 16384, used: 8192, percent: 50 },
        loadThreshold: 4.0,
        isThrottled: false,
      };
      mockDebugService.getSystemLoad.mockResolvedValue(loadInfo);

      const result = await controller.getSystemLoad();

      expect(result).toEqual(loadInfo);
    });
  });

  describe('getFfmpegProcesses', () => {
    it('should return list of FFmpeg processes', async () => {
      const processes = [
        { pid: 1234, command: 'ffmpeg -i input.mkv', isZombie: false },
        { pid: 5678, command: 'ffmpeg -i other.mkv', isZombie: true },
      ];
      mockDebugService.getFfmpegProcesses.mockResolvedValue(processes);

      const result = await controller.getFfmpegProcesses();

      expect(result).toEqual(processes);
      expect(result).toHaveLength(2);
    });
  });

  describe('killFfmpegProcess', () => {
    it('should kill process by PID', async () => {
      mockDebugService.killProcessByPid.mockResolvedValue({ killed: true, pid: 1234 });

      const result = await controller.killFfmpegProcess(1234);

      expect(result).toEqual({ killed: true, pid: 1234 });
      expect(mockDebugService.killProcessByPid).toHaveBeenCalledWith(1234);
    });

    it('should propagate errors for invalid PID', async () => {
      mockDebugService.killProcessByPid.mockRejectedValue(new Error('Process not found'));

      await expect(controller.killFfmpegProcess(9999)).rejects.toThrow('Process not found');
    });
  });

  describe('killAllZombies', () => {
    it('should return summary of killed processes', async () => {
      const summary = { killed: 3, failed: 0, pids: [1234, 5678, 9012] };
      mockDebugService.killAllZombies.mockResolvedValue(summary);

      const result = await controller.killAllZombies();

      expect(result).toEqual(summary);
    });
  });

  describe('updateLoadThreshold', () => {
    it('should update load threshold multiplier', async () => {
      mockDebugService.updateLoadThreshold.mockResolvedValue({
        multiplier: 5.0,
        effectiveThreshold: 40,
      });

      const result = await controller.updateLoadThreshold({ loadThresholdMultiplier: 5.0 });

      expect(result).toEqual({ multiplier: 5.0, effectiveThreshold: 40 });
      expect(mockDebugService.updateLoadThreshold).toHaveBeenCalledWith(5.0);
    });
  });
});
