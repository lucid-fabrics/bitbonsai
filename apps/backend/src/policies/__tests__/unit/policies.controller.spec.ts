import { Test, type TestingModule } from '@nestjs/testing';
import { PoliciesController } from '../../policies.controller';
import { PoliciesService } from '../../policies.service';

describe('PoliciesController', () => {
  let controller: PoliciesController;

  const mockPoliciesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    getPresets: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PoliciesController],
      providers: [{ provide: PoliciesService, useValue: mockPoliciesService }],
    }).compile();

    controller = module.get<PoliciesController>(PoliciesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call service.create with the dto and return the result', async () => {
      const dto = { name: 'My Policy', codec: 'HEVC', crf: 23 } as never;
      const expected = { id: 'policy-1', name: 'My Policy', codec: 'HEVC', crf: 23 };
      mockPoliciesService.create.mockResolvedValue(expected);

      const result = await controller.create(dto);

      expect(mockPoliciesService.create).toHaveBeenCalledWith(dto);
      expect(mockPoliciesService.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expected);
    });

    it('should propagate service errors', async () => {
      mockPoliciesService.create.mockRejectedValue(new Error('create failed'));
      await expect(controller.create({} as never)).rejects.toThrow('create failed');
    });
  });

  describe('findAll', () => {
    it('should call service.findAll and return all policies', async () => {
      const policies = [{ id: 'p1' }, { id: 'p2' }];
      mockPoliciesService.findAll.mockResolvedValue(policies);

      const result = await controller.findAll();

      expect(mockPoliciesService.findAll).toHaveBeenCalledTimes(1);
      expect(result).toEqual(policies);
    });

    it('should propagate service errors', async () => {
      mockPoliciesService.findAll.mockRejectedValue(new Error('db error'));
      await expect(controller.findAll()).rejects.toThrow('db error');
    });
  });

  describe('getPresets', () => {
    it('should call service.getPresets and return presets array', () => {
      const presets = [{ name: 'BALANCED_HEVC' }, { name: 'FAST_HEVC' }];
      mockPoliciesService.getPresets.mockReturnValue(presets);

      const result = controller.getPresets();

      expect(mockPoliciesService.getPresets).toHaveBeenCalledTimes(1);
      expect(result).toEqual(presets);
    });

    it('should return empty array when no presets available', () => {
      mockPoliciesService.getPresets.mockReturnValue([]);
      expect(controller.getPresets()).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should call service.findOne with the id and return stats', async () => {
      const stats = { id: 'p1', completedJobs: 42 };
      mockPoliciesService.findOne.mockResolvedValue(stats);

      const result = await controller.findOne('p1');

      expect(mockPoliciesService.findOne).toHaveBeenCalledWith('p1');
      expect(mockPoliciesService.findOne).toHaveBeenCalledTimes(1);
      expect(result).toEqual(stats);
    });

    it('should propagate not-found errors', async () => {
      mockPoliciesService.findOne.mockRejectedValue(new Error('not found'));
      await expect(controller.findOne('missing-id')).rejects.toThrow('not found');
    });
  });

  describe('update', () => {
    it('should call service.update with id and dto and return updated policy', async () => {
      const dto = { crf: 26 } as never;
      const updated = { id: 'p1', crf: 26 };
      mockPoliciesService.update.mockResolvedValue(updated);

      const result = await controller.update('p1', dto);

      expect(mockPoliciesService.update).toHaveBeenCalledWith('p1', dto);
      expect(mockPoliciesService.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual(updated);
    });

    it('should propagate service errors', async () => {
      mockPoliciesService.update.mockRejectedValue(new Error('update failed'));
      await expect(controller.update('p1', {} as never)).rejects.toThrow('update failed');
    });
  });

  describe('remove', () => {
    it('should call service.remove with the id', async () => {
      mockPoliciesService.remove.mockResolvedValue(undefined);

      const result = await controller.remove('p1');

      expect(mockPoliciesService.remove).toHaveBeenCalledWith('p1');
      expect(mockPoliciesService.remove).toHaveBeenCalledTimes(1);
      expect(result).toBeUndefined();
    });

    it('should propagate service errors', async () => {
      mockPoliciesService.remove.mockRejectedValue(new Error('delete failed'));
      await expect(controller.remove('p1')).rejects.toThrow('delete failed');
    });
  });
});
