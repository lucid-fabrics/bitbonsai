import { FilePathBo } from './file-path.bo';

describe('FilePathBo', () => {
  describe('getFileName', () => {
    it('should extract filename from full path', () => {
      expect(FilePathBo.getFileName('/media/movies/movie.mkv')).toBe('movie.mkv');
    });

    it('should return the input when there is no slash', () => {
      expect(FilePathBo.getFileName('movie.mkv')).toBe('movie.mkv');
    });

    it('should handle nested directories', () => {
      expect(FilePathBo.getFileName('/a/b/c/d/file.mp4')).toBe('file.mp4');
    });

    it('should return empty string for trailing slash', () => {
      expect(FilePathBo.getFileName('/media/movies/')).toBe('');
    });
  });

  describe('getFileExtension', () => {
    it('should return lowercase extension', () => {
      expect(FilePathBo.getFileExtension('/media/Movie.MKV')).toBe('mkv');
    });

    it('should return empty string for files without extension', () => {
      expect(FilePathBo.getFileExtension('/media/Dockerfile')).toBe('');
    });

    it('should handle dotfiles without extension', () => {
      expect(FilePathBo.getFileExtension('/home/.bashrc')).toBe('');
    });

    it('should handle multiple dots in filename', () => {
      expect(FilePathBo.getFileExtension('/media/movie.2024.mkv')).toBe('mkv');
    });
  });

  describe('getDirectoryPath', () => {
    it('should return directory portion of path', () => {
      expect(FilePathBo.getDirectoryPath('/media/movies/movie.mkv')).toBe('/media/movies');
    });

    it('should return empty string for root-level file', () => {
      expect(FilePathBo.getDirectoryPath('file.txt')).toBe('');
    });

    it('should handle deeply nested paths', () => {
      expect(FilePathBo.getDirectoryPath('/a/b/c/file.mp4')).toBe('/a/b/c');
    });
  });

  describe('isVideoFile', () => {
    it('should return true for mp4', () => {
      expect(FilePathBo.isVideoFile('/media/movie.mp4')).toBe(true);
    });

    it('should return true for mkv', () => {
      expect(FilePathBo.isVideoFile('/media/movie.mkv')).toBe(true);
    });

    it('should return true for MKV (case-insensitive via lowercase)', () => {
      expect(FilePathBo.isVideoFile('/media/movie.MKV')).toBe(true);
    });

    it('should return false for jpg', () => {
      expect(FilePathBo.isVideoFile('/media/photo.jpg')).toBe(false);
    });

    it('should return false for pdf', () => {
      expect(FilePathBo.isVideoFile('/docs/report.pdf')).toBe(false);
    });

    it('should return false for file with no extension', () => {
      expect(FilePathBo.isVideoFile('/media/noext')).toBe(false);
    });
  });
});
