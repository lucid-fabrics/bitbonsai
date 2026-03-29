import { Test, type TestingModule } from '@nestjs/testing';
import { FilesystemController } from '../../filesystem.controller';
import { FilesystemService } from '../../filesystem.service';

describe('FilesystemController', () => {
  let controller: FilesystemController;
  let service: jest.Mocked<FilesystemService>;

  const mockDirectoryListing = {
    currentPath: '/media',
    parentPath: '/',
    directories: [
      { name: 'Movies', path: '/media/Movies', isAccessible: true },
      { name: 'TV', path: '/media/TV', isAccessible: true },
    ],
  };

  beforeEach(async () => {
    const mockFilesystemService = {
      listDirectories: jest.fn().mockResolvedValue(mockDirectoryListing),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FilesystemController],
      providers: [{ provide: FilesystemService, useValue: mockFilesystemService }],
    }).compile();

    controller = module.get<FilesystemController>(FilesystemController);
    service = module.get(FilesystemService) as jest.Mocked<FilesystemService>;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('browseDirectories', () => {
    it('should return directory listing for specified path', async () => {
      const result = await controller.browseDirectories('/media');

      expect(result).toEqual(mockDirectoryListing);
      expect(service.listDirectories).toHaveBeenCalledWith('/media');
    });

    it('should default to root path when no path provided', async () => {
      const result = await controller.browseDirectories();

      expect(result).toEqual(mockDirectoryListing);
      expect(service.listDirectories).toHaveBeenCalledWith('/');
    });

    it('should handle empty path parameter', async () => {
      const result = await controller.browseDirectories(undefined);

      expect(result).toEqual(mockDirectoryListing);
      expect(service.listDirectories).toHaveBeenCalledWith('/');
    });
  });
});
