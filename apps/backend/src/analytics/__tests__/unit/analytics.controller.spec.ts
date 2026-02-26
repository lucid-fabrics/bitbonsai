import { Test, type TestingModule } from '@nestjs/testing';
import { AnalyticsService } from '../../analytics.service';
import { AnalyticsController } from '../../analytics.controller';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: {
    getSpaceSavingsOverTime: jest.Mock;
    getEncodingSpeedTrends: jest.Mock;
    getCostSavings: jest.Mock;
    getNodePerformance: jest.Mock;
    getCodecPerformance: jest.Mock;
  };

  beforeEach(async () => {
    analyticsService = {
      getSpaceSavingsOverTime: jest.fn().mockResolvedValue({ saved: '100GB' }),
      getEncodingSpeedTrends: jest.fn().mockResolvedValue({ speed: '2x' }),
      getCostSavings: jest.fn().mockResolvedValue({ saved: '$50' }),
      getNodePerformance: jest.fn().mockResolvedValue({ nodes: [] }),
      getCodecPerformance: jest.fn().mockResolvedValue({ codecs: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: analyticsService }],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSpaceSavings', () => {
    it('should return space savings with default period', async () => {
      const result = await controller.getSpaceSavings();
      expect(analyticsService.getSpaceSavingsOverTime).toHaveBeenCalledWith('30d');
      expect(result).toEqual({ saved: '100GB' });
    });

    it('should use provided period', async () => {
      await controller.getSpaceSavings('7d');
      expect(analyticsService.getSpaceSavingsOverTime).toHaveBeenCalledWith('7d');
    });
  });

  describe('getEncodingSpeed', () => {
    it('should return encoding speed with default period', async () => {
      const result = await controller.getEncodingSpeed();
      expect(analyticsService.getEncodingSpeedTrends).toHaveBeenCalledWith('30d');
      expect(result).toEqual({ speed: '2x' });
    });

    it('should use provided period', async () => {
      await controller.getEncodingSpeed('24h');
      expect(analyticsService.getEncodingSpeedTrends).toHaveBeenCalledWith('24h');
    });
  });

  describe('getCostSavings', () => {
    it('should return cost savings with default provider', async () => {
      const result = await controller.getCostSavings();
      expect(analyticsService.getCostSavings).toHaveBeenCalledWith('AWS S3');
      expect(result).toEqual({ saved: '$50' });
    });

    it('should use provided provider', async () => {
      await controller.getCostSavings('Backblaze B2');
      expect(analyticsService.getCostSavings).toHaveBeenCalledWith('Backblaze B2');
    });
  });

  describe('getNodePerformance', () => {
    it('should return node performance with default period', async () => {
      await controller.getNodePerformance();
      expect(analyticsService.getNodePerformance).toHaveBeenCalledWith('30d');
    });
  });

  describe('getCodecPerformance', () => {
    it('should return codec performance with default period', async () => {
      await controller.getCodecPerformance();
      expect(analyticsService.getCodecPerformance).toHaveBeenCalledWith('30d');
    });
  });

  describe('getSummary', () => {
    it('should return complete summary with default period', async () => {
      const result = await controller.getSummary();

      expect(result.period).toBe('30d');
      expect(result.spaceSavings).toEqual({ saved: '100GB' });
      expect(result.encodingSpeed).toEqual({ speed: '2x' });
      expect(result.costSavings).toEqual({ saved: '$50' });
      expect(result.nodePerformance).toEqual({ nodes: [] });
      expect(result.codecPerformance).toEqual({ codecs: [] });
    });

    it('should use provided period for all queries', async () => {
      await controller.getSummary('90d');

      expect(analyticsService.getSpaceSavingsOverTime).toHaveBeenCalledWith('90d');
      expect(analyticsService.getEncodingSpeedTrends).toHaveBeenCalledWith('90d');
      expect(analyticsService.getNodePerformance).toHaveBeenCalledWith('90d');
      expect(analyticsService.getCodecPerformance).toHaveBeenCalledWith('90d');
      // Cost savings always uses AWS S3
      expect(analyticsService.getCostSavings).toHaveBeenCalledWith('AWS S3');
    });
  });
});
