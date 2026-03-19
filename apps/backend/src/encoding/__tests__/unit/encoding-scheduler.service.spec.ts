import { Test, type TestingModule } from '@nestjs/testing';
import { JobRepository } from '../../../common/repositories/job.repository';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { EncodingSchedulerService, type TimeWindow } from '../../encoding-scheduler.service';

describe('EncodingSchedulerService', () => {
  let service: EncodingSchedulerService;
  let nodeRepository: Record<string, jest.Mock>;
  let jobRepository: Record<string, jest.Mock>;

  beforeEach(async () => {
    nodeRepository = {
      findWithSelect: jest.fn(),
      findManySelect: jest.fn().mockResolvedValue([]),
      updateData: jest.fn().mockResolvedValue({}),
    };

    jobRepository = {
      atomicUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncodingSchedulerService,
        { provide: NodeRepository, useValue: nodeRepository },
        { provide: JobRepository, useValue: jobRepository },
      ],
    }).compile();

    service = module.get<EncodingSchedulerService>(EncodingSchedulerService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('isEncodingAllowed', () => {
    it('should return true when node not found', async () => {
      nodeRepository.findWithSelect.mockResolvedValue(null);

      const result = await service.isEncodingAllowed('node-1');

      expect(result).toBe(true);
    });

    it('should return true when scheduling is disabled', async () => {
      nodeRepository.findWithSelect.mockResolvedValue({
        scheduleEnabled: false,
        scheduleWindows: null,
      });

      const result = await service.isEncodingAllowed('node-1');

      expect(result).toBe(true);
    });

    it('should return true when scheduling enabled but no windows defined', async () => {
      nodeRepository.findWithSelect.mockResolvedValue({
        scheduleEnabled: true,
        scheduleWindows: null,
      });

      const result = await service.isEncodingAllowed('node-1');

      expect(result).toBe(true);
    });

    it('should return true when scheduling enabled with empty windows', async () => {
      nodeRepository.findWithSelect.mockResolvedValue({
        scheduleEnabled: true,
        scheduleWindows: [],
      });

      const result = await service.isEncodingAllowed('node-1');

      expect(result).toBe(true);
    });

    it('should return true when current time is inside a window', async () => {
      const now = new Date();
      const currentDay = now.getDay();
      const currentHour = now.getHours();

      const windows: TimeWindow[] = [
        {
          dayOfWeek: currentDay,
          startHour: currentHour,
          endHour: currentHour + 2 > 23 ? 23 : currentHour + 2,
        },
      ];

      nodeRepository.findWithSelect.mockResolvedValue({
        scheduleEnabled: true,
        scheduleWindows: windows,
      });

      const result = await service.isEncodingAllowed('node-1');

      // Only true if currentHour < endHour
      if (currentHour < (currentHour + 2 > 23 ? 23 : currentHour + 2)) {
        expect(result).toBe(true);
      }
    });

    it('should return false when current time is outside all windows', async () => {
      const now = new Date();
      const currentDay = now.getDay();
      const futureDay = (currentDay + 3) % 7; // 3 days from now, different day

      const windows: TimeWindow[] = [
        {
          dayOfWeek: futureDay,
          startHour: 0,
          endHour: 24,
        },
      ];

      nodeRepository.findWithSelect.mockResolvedValue({
        scheduleEnabled: true,
        scheduleWindows: windows,
      });

      const result = await service.isEncodingAllowed('node-1');

      expect(result).toBe(false);
    });

    it('should handle overnight windows correctly', async () => {
      const now = new Date();
      const currentDay = now.getDay();
      const currentHour = now.getHours();

      // Create an overnight window that includes current time
      const windows: TimeWindow[] = [
        {
          dayOfWeek: currentDay,
          startHour: currentHour > 0 ? currentHour - 1 : 23,
          endHour: currentHour > 0 ? currentHour - 2 : 22, // Wraps around: start > end
        },
      ];

      // Only test if we can construct a valid overnight window
      if (windows[0].startHour > windows[0].endHour) {
        nodeRepository.findWithSelect.mockResolvedValue({
          scheduleEnabled: true,
          scheduleWindows: windows,
        });

        const result = await service.isEncodingAllowed('node-1');

        // Current hour >= startHour, so should be in overnight window
        expect(result).toBe(true);
      }
    });

    it('should return true on error', async () => {
      nodeRepository.findWithSelect.mockRejectedValue(new Error('Database error'));

      const result = await service.isEncodingAllowed('node-1');

      expect(result).toBe(true);
    });
  });

  describe('getNextAllowedTime', () => {
    it('should return null when scheduling disabled', async () => {
      nodeRepository.findWithSelect.mockResolvedValue({
        scheduleEnabled: false,
        scheduleWindows: null,
      });

      const result = await service.getNextAllowedTime('node-1');

      expect(result).toBeNull();
    });

    it('should return null when node not found', async () => {
      nodeRepository.findWithSelect.mockResolvedValue(null);

      const result = await service.getNextAllowedTime('node-1');

      expect(result).toBeNull();
    });

    it('should return null when no windows defined', async () => {
      nodeRepository.findWithSelect.mockResolvedValue({
        scheduleEnabled: true,
        scheduleWindows: [],
      });

      const result = await service.getNextAllowedTime('node-1');

      expect(result).toBeNull();
    });

    it('should return null when currently in a window', async () => {
      const now = new Date();
      const currentDay = now.getDay();
      const currentHour = now.getHours();

      const windows: TimeWindow[] = [
        {
          dayOfWeek: currentDay,
          startHour: currentHour,
          endHour: currentHour + 2 > 23 ? 23 : currentHour + 2,
        },
      ];

      nodeRepository.findWithSelect.mockResolvedValue({
        scheduleEnabled: true,
        scheduleWindows: windows,
      });

      const result = await service.getNextAllowedTime('node-1');

      if (currentHour < (currentHour + 2 > 23 ? 23 : currentHour + 2)) {
        expect(result).toBeNull();
      }
    });

    it('should return future date when outside windows', async () => {
      const now = new Date();
      const tomorrowDay = (now.getDay() + 1) % 7;

      const windows: TimeWindow[] = [
        {
          dayOfWeek: tomorrowDay,
          startHour: 10,
          endHour: 14,
        },
      ];

      nodeRepository.findWithSelect.mockResolvedValue({
        scheduleEnabled: true,
        scheduleWindows: windows,
      });

      const result = await service.getNextAllowedTime('node-1');

      expect(result).toBeInstanceOf(Date);
      expect(result!.getTime()).toBeGreaterThan(now.getTime());
    });

    it('should return null on error', async () => {
      nodeRepository.findWithSelect.mockRejectedValue(new Error('Database error'));

      const result = await service.getNextAllowedTime('node-1');

      expect(result).toBeNull();
    });
  });

  describe('enforceSchedules', () => {
    it('should do nothing when no nodes have scheduling enabled', async () => {
      nodeRepository.findManySelect.mockResolvedValue([]);

      await service.enforceSchedules();

      expect(jobRepository.atomicUpdateMany).not.toHaveBeenCalled();
    });

    it('should skip nodes with empty windows', async () => {
      nodeRepository.findManySelect.mockResolvedValue([
        { id: 'node-1', name: 'Node 1', scheduleWindows: [] },
      ]);

      await service.enforceSchedules();

      expect(jobRepository.atomicUpdateMany).not.toHaveBeenCalled();
    });

    it('should pause jobs when outside schedule window', async () => {
      const now = new Date();
      const differentDay = (now.getDay() + 3) % 7;

      nodeRepository.findManySelect.mockResolvedValue([
        {
          id: 'node-1',
          name: 'Node 1',
          scheduleWindows: [{ dayOfWeek: differentDay, startHour: 0, endHour: 24 }],
        },
      ]);

      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 2 });

      await service.enforceSchedules();

      expect(jobRepository.atomicUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'node-1' }),
        expect.objectContaining({
          stage: 'PAUSED',
          error: 'Paused: Outside scheduled encoding window',
        })
      );
    });

    it('should resume jobs when inside schedule window', async () => {
      const now = new Date();
      const currentDay = now.getDay();
      const _currentHour = now.getHours();

      nodeRepository.findManySelect.mockResolvedValue([
        {
          id: 'node-1',
          name: 'Node 1',
          scheduleWindows: [{ dayOfWeek: currentDay, startHour: 0, endHour: 24 }],
        },
      ]);

      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 1 });

      await service.enforceSchedules();

      expect(jobRepository.atomicUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'node-1' }),
        expect.objectContaining({
          stage: 'QUEUED',
          error: null,
        })
      );
    });

    it('should handle errors gracefully', async () => {
      nodeRepository.findManySelect.mockRejectedValue(new Error('Database error'));

      await expect(service.enforceSchedules()).resolves.not.toThrow();
    });
  });

  describe('setNodeSchedule', () => {
    it('should enable scheduling with windows', async () => {
      const windows: TimeWindow[] = [{ dayOfWeek: 1, startHour: 22, endHour: 6 }];

      nodeRepository.updateData.mockResolvedValue({});

      await service.setNodeSchedule('node-1', true, windows);

      expect(nodeRepository.updateData).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({
          scheduleEnabled: true,
        })
      );
    });

    it('should disable scheduling', async () => {
      nodeRepository.updateData.mockResolvedValue({});

      await service.setNodeSchedule('node-1', false);

      expect(nodeRepository.updateData).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({
          scheduleEnabled: false,
        })
      );
    });
  });

  describe('getPresetSchedules', () => {
    it('should return preset schedules', () => {
      const presets = service.getPresetSchedules();

      expect(presets).toHaveProperty('nights');
      expect(presets).toHaveProperty('weekends');
      expect(presets).toHaveProperty('weekdayNights');
      expect(presets).toHaveProperty('offPeak');
      expect(presets).toHaveProperty('nonBusinessHours');
    });

    it('should have 7 windows for nights preset (every day)', () => {
      const presets = service.getPresetSchedules();

      expect(presets.nights).toHaveLength(7);
      expect(presets.nights[0]).toEqual({ dayOfWeek: 0, startHour: 22, endHour: 6 });
    });

    it('should have weekend windows for weekends preset', () => {
      const presets = service.getPresetSchedules();

      expect(presets.weekends).toHaveLength(2);
      expect(presets.weekends.map((w) => w.dayOfWeek)).toEqual([0, 6]);
    });

    it('should have weekday-only windows for weekdayNights', () => {
      const presets = service.getPresetSchedules();

      expect(presets.weekdayNights).toHaveLength(5);
      expect(presets.weekdayNights.map((w) => w.dayOfWeek)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should have combined windows for offPeak', () => {
      const presets = service.getPresetSchedules();

      // 5 weekday nights + 2 weekend days = 7
      expect(presets.offPeak).toHaveLength(7);
    });

    it('should have expanded windows for nonBusinessHours', () => {
      const presets = service.getPresetSchedules();

      // 5 weekdays × 2 windows + 2 weekend days = 12
      expect(presets.nonBusinessHours).toHaveLength(12);
    });
  });
});
