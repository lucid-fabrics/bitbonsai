import { Test, type TestingModule } from '@nestjs/testing';
import { FilesystemController } from '../../filesystem.controller';
import { FilesystemService } from '../../filesystem.service';

describe('FilesystemController', () => {
  let controller: FilesystemController;

  const mockFilesystemService = {
    listDirectories: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FilesystemController],
      providers: [{ provide: FilesystemService, useValue: mockFilesystemService }],
    }).compile();

    controller = module.get<FilesystemController>(FilesystemController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('browseDirectories', () => {
    it('should return directory listing for a given path', async () => {
      const result = {
        currentPath: '/media',
        parentPath: '/',
        directories: [
          { name: 'Movies', path: '/media/Movies', isAccessible: true },
          { name: 'TV', path: '/media/TV', isAccessible: true },
        ],
      };
      mockFilesystemService.listDirectories.mockResolvedValue(result);

      const response = await controller.browseDirectories('/media');

      expect(mockFilesystemService.listDirectories).toHaveBeenCalledWith('/media');
      expect(response).toEqual(result);
    });

    it('should default to "/" when path query param is omitted', async () => {
      const result = { currentPath: '/', parentPath: null, directories: [] };
      mockFilesystemService.listDirectories.mockResolvedValue(result);

      const response = await controller.browseDirectories(undefined);

      expect(mockFilesystemService.listDirectories).toHaveBeenCalledWith('/');
      expect(response).toEqual(result);
    });

    it('should propagate service errors', async () => {
      mockFilesystemService.listDirectories.mockRejectedValue(new Error('permission denied'));
      await expect(controller.browseDirectories('/root')).rejects.toThrow('permission denied');
    });
  });
});
