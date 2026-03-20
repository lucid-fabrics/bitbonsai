import { Test, type TestingModule } from '@nestjs/testing';
import { LibrariesController } from '../../libraries.controller';
import { LibrariesService } from '../../libraries.service';

describe('LibrariesController', () => {
  let controller: LibrariesController;

  const mockLibrariesService = {
    create: jest.fn(),
    getAllReadyFiles: jest.fn(),
    getCacheMetadata: jest.fn(),
    invalidateReadyFilesCache: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    getLibraryFiles: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    scan: jest.fn(),
    scanPreview: jest.fn(),
    createJobsFromScan: jest.fn(),
    createAllJobs: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LibrariesController],
      providers: [{ provide: LibrariesService, useValue: mockLibrariesService }],
    }).compile();

    controller = module.get<LibrariesController>(LibrariesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call service and return created library', async () => {
      const dto = { name: 'Movies', path: '/mnt/movies', nodeId: 'node1', mediaType: 'MOVIE' };
      const created = { id: 'lib1', ...dto };
      mockLibrariesService.create.mockResolvedValue(created);

      const result = await controller.create(dto as any);

      expect(mockLibrariesService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(created);
    });

    it('should propagate service errors', async () => {
      mockLibrariesService.create.mockRejectedValue(new Error('node not found'));
      await expect(controller.create({} as any)).rejects.toThrow('node not found');
    });
  });

  describe('getAllReadyFiles', () => {
    it('should return scan previews from service', async () => {
      const previews = [{ libraryId: 'lib1', filesNeedingEncoding: [] }];
      mockLibrariesService.getAllReadyFiles.mockResolvedValue(previews);

      const result = await controller.getAllReadyFiles();

      expect(mockLibrariesService.getAllReadyFiles).toHaveBeenCalledTimes(1);
      expect(result).toEqual(previews);
    });

    it('should propagate service errors', async () => {
      mockLibrariesService.getAllReadyFiles.mockRejectedValue(new Error('scan failed'));
      await expect(controller.getAllReadyFiles()).rejects.toThrow('scan failed');
    });
  });

  describe('getReadyCacheMetadata', () => {
    it('should return cache metadata from service', async () => {
      const metadata = { age: 30, ttl: 300, isValid: true };
      mockLibrariesService.getCacheMetadata.mockResolvedValue(metadata);

      const result = await controller.getReadyCacheMetadata();

      expect(mockLibrariesService.getCacheMetadata).toHaveBeenCalledTimes(1);
      expect(result).toEqual(metadata);
    });

    it('should propagate service errors', async () => {
      mockLibrariesService.getCacheMetadata.mockRejectedValue(new Error('cache error'));
      await expect(controller.getReadyCacheMetadata()).rejects.toThrow('cache error');
    });
  });

  describe('refreshReadyCache', () => {
    it('should invalidate cache and return success message', async () => {
      const result = await controller.refreshReadyCache();

      expect(mockLibrariesService.invalidateReadyFilesCache).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ message: 'Ready files cache invalidated successfully' });
    });
  });

  describe('findAll', () => {
    it('should return all libraries', async () => {
      const libraries = [
        { id: 'lib1', name: 'Movies' },
        { id: 'lib2', name: 'Shows' },
      ];
      mockLibrariesService.findAll.mockResolvedValue(libraries);

      const result = await controller.findAll();

      expect(mockLibrariesService.findAll).toHaveBeenCalledTimes(1);
      expect(result).toEqual(libraries);
    });

    it('should propagate service errors', async () => {
      mockLibrariesService.findAll.mockRejectedValue(new Error('db error'));
      await expect(controller.findAll()).rejects.toThrow('db error');
    });
  });

  describe('findOne', () => {
    it('should return a single library by id', async () => {
      const library = { id: 'lib1', name: 'Movies', totalFiles: 100 };
      mockLibrariesService.findOne.mockResolvedValue(library);

      const result = await controller.findOne('lib1');

      expect(mockLibrariesService.findOne).toHaveBeenCalledWith('lib1');
      expect(result).toEqual(library);
    });

    it('should propagate not found errors', async () => {
      mockLibrariesService.findOne.mockRejectedValue(new Error('not found'));
      await expect(controller.findOne('missing')).rejects.toThrow('not found');
    });
  });

  describe('getLibraryFiles', () => {
    it('should return files in a library', async () => {
      const files = { files: [{ path: '/mnt/movies/a.mkv', codec: 'h264' }], total: 1 };
      mockLibrariesService.getLibraryFiles.mockResolvedValue(files);

      const result = await controller.getLibraryFiles('lib1');

      expect(mockLibrariesService.getLibraryFiles).toHaveBeenCalledWith('lib1');
      expect(result).toEqual(files);
    });

    it('should propagate service errors', async () => {
      mockLibrariesService.getLibraryFiles.mockRejectedValue(new Error('scan error'));
      await expect(controller.getLibraryFiles('lib1')).rejects.toThrow('scan error');
    });
  });

  describe('update', () => {
    it('should update a library and return updated record', async () => {
      const dto = { name: 'Updated Movies' };
      const updated = { id: 'lib1', name: 'Updated Movies' };
      mockLibrariesService.update.mockResolvedValue(updated);

      const result = await controller.update('lib1', dto as any);

      expect(mockLibrariesService.update).toHaveBeenCalledWith('lib1', dto);
      expect(result).toEqual(updated);
    });

    it('should propagate service errors', async () => {
      mockLibrariesService.update.mockRejectedValue(new Error('update failed'));
      await expect(controller.update('lib1', {} as any)).rejects.toThrow('update failed');
    });
  });

  describe('remove', () => {
    it('should remove a library', async () => {
      mockLibrariesService.remove.mockResolvedValue(undefined);

      await controller.remove('lib1');

      expect(mockLibrariesService.remove).toHaveBeenCalledWith('lib1');
    });

    it('should propagate service errors', async () => {
      mockLibrariesService.remove.mockRejectedValue(new Error('not found'));
      await expect(controller.remove('missing')).rejects.toThrow('not found');
    });
  });

  describe('scan', () => {
    it('should trigger a library scan and return updated library', async () => {
      const library = { id: 'lib1', lastScanAt: new Date() };
      mockLibrariesService.scan.mockResolvedValue(library);

      const result = await controller.scan('lib1');

      expect(mockLibrariesService.scan).toHaveBeenCalledWith('lib1');
      expect(result).toEqual(library);
    });

    it('should propagate service errors', async () => {
      mockLibrariesService.scan.mockRejectedValue(new Error('library disabled'));
      await expect(controller.scan('lib1')).rejects.toThrow('library disabled');
    });
  });

  describe('scanPreview', () => {
    it('should return scan preview without creating jobs', async () => {
      const preview = { filesNeedingEncoding: [{ path: '/mnt/a.mkv' }], alreadyOptimized: [] };
      mockLibrariesService.scanPreview.mockResolvedValue(preview);

      const result = await controller.scanPreview('lib1');

      expect(mockLibrariesService.scanPreview).toHaveBeenCalledWith('lib1');
      expect(result).toEqual(preview);
    });

    it('should propagate service errors', async () => {
      mockLibrariesService.scanPreview.mockRejectedValue(new Error('no policy'));
      await expect(controller.scanPreview('lib1')).rejects.toThrow('no policy');
    });
  });

  describe('createJobsFromScan', () => {
    it('should create jobs from scan with all file paths', async () => {
      const dto = { policyId: 'pol1', filePaths: ['/mnt/a.mkv', '/mnt/b.mkv'] };
      const response = { jobsCreated: 2, jobs: [] };
      mockLibrariesService.createJobsFromScan.mockResolvedValue(response);

      const result = await controller.createJobsFromScan('lib1', dto as any);

      expect(mockLibrariesService.createJobsFromScan).toHaveBeenCalledWith(
        'lib1',
        dto.policyId,
        dto.filePaths
      );
      expect(result).toEqual(response);
    });

    it('should create jobs with undefined filePaths when omitted', async () => {
      const dto = { policyId: 'pol1' };
      const response = { jobsCreated: 5, jobs: [] };
      mockLibrariesService.createJobsFromScan.mockResolvedValue(response);

      await controller.createJobsFromScan('lib1', dto as any);

      expect(mockLibrariesService.createJobsFromScan).toHaveBeenCalledWith(
        'lib1',
        'pol1',
        undefined
      );
    });

    it('should propagate service errors', async () => {
      mockLibrariesService.createJobsFromScan.mockRejectedValue(new Error('policy not found'));
      await expect(
        controller.createJobsFromScan('lib1', { policyId: 'bad' } as any)
      ).rejects.toThrow('policy not found');
    });
  });

  describe('createAllJobs', () => {
    it('should create bulk jobs for all files', async () => {
      const dto = { policyId: 'pol1' };
      const result = { created: 10, skipped: 2, failed: 0 };
      mockLibrariesService.createAllJobs.mockResolvedValue(result);

      const res = await controller.createAllJobs('lib1', dto as any);

      expect(mockLibrariesService.createAllJobs).toHaveBeenCalledWith('lib1', 'pol1');
      expect(res).toEqual(result);
    });

    it('should propagate service errors', async () => {
      mockLibrariesService.createAllJobs.mockRejectedValue(new Error('library not found'));
      await expect(controller.createAllJobs('lib1', { policyId: 'pol1' } as any)).rejects.toThrow(
        'library not found'
      );
    });
  });
});
