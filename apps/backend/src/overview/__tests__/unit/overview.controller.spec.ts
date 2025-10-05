import { Test, type TestingModule } from '@nestjs/testing';
import type { OverviewResponseDto } from '../../dto/overview-response.dto';
import { OverviewController } from '../../overview.controller';
import { OverviewService } from '../../overview.service';

describe('OverviewController', () => {
  let controller: OverviewController;
  let service: OverviewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OverviewController],
      providers: [
        {
          provide: OverviewService,
          useValue: {
            getOverview: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<OverviewController>(OverviewController);
    service = module.get<OverviewService>(OverviewService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getOverview', () => {
    it('should return overview statistics in snake_case format', async () => {
      const mockOverview: OverviewResponseDto = {
        system_health: {
          active_nodes: {
            current: 3,
            total: 5,
          },
          queue_status: {
            encoding_count: 5,
          },
          storage_saved: {
            total_tb: 2.5,
          },
          success_rate: {
            percentage: 95.5,
          },
        },
        queue_summary: {
          queued: 25,
          encoding: 8,
          completed: 342,
          failed: 5,
        },
        recent_activity: [
          {
            id: 'job-1',
            file_name: 'Movie.mkv',
            library: 'Movies',
            codec_change: 'H.264 → HEVC',
            savings_gb: 1.25,
            duration_seconds: 0,
            completed_at: '2025-09-30T21:45:32.123Z',
          },
        ],
        top_libraries: [
          {
            name: 'Main Movies',
            job_count: 127,
            total_savings_gb: 15.5,
          },
        ],
        last_updated: '2025-09-30T21:45:32.123Z',
      };

      jest.spyOn(service, 'getOverview').mockResolvedValue(mockOverview);

      const result = await controller.getOverview();

      expect(service.getOverview).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockOverview);
      expect(result.system_health.active_nodes.current).toBe(3);
      expect(result.queue_summary.queued).toBe(25);
      expect(result.recent_activity).toHaveLength(1);
      expect(result.top_libraries).toHaveLength(1);
    });

    it('should propagate errors from service', async () => {
      const error = new Error('Database error');
      jest.spyOn(service, 'getOverview').mockRejectedValue(error);

      await expect(controller.getOverview()).rejects.toThrow('Database error');
    });

    it('should return empty arrays when no data exists', async () => {
      const mockOverview: OverviewResponseDto = {
        system_health: {
          active_nodes: {
            current: 0,
            total: 0,
          },
          queue_status: {
            encoding_count: 0,
          },
          storage_saved: {
            total_tb: 0,
          },
          success_rate: {
            percentage: 0,
          },
        },
        queue_summary: {
          queued: 0,
          encoding: 0,
          completed: 0,
          failed: 0,
        },
        recent_activity: [],
        top_libraries: [],
        last_updated: '2025-09-30T21:45:32.123Z',
      };

      jest.spyOn(service, 'getOverview').mockResolvedValue(mockOverview);

      const result = await controller.getOverview();

      expect(result.recent_activity).toEqual([]);
      expect(result.top_libraries).toEqual([]);
      expect(result.system_health.active_nodes.current).toBe(0);
    });
  });
});
