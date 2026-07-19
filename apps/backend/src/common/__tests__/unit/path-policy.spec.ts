import { isAbsoluteLibraryPath, isBlockedSystemPath } from '../../path-policy';

describe('path-policy', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('isAbsoluteLibraryPath', () => {
    it('accepts POSIX absolute paths', () => {
      expect(isAbsoluteLibraryPath('/Volumes/Sigma Setup')).toBe(true);
      expect(isAbsoluteLibraryPath('/mnt/user/media')).toBe(true);
    });

    it('rejects relative paths on POSIX', () => {
      expect(isAbsoluteLibraryPath('relative/path')).toBe(false);
    });

    it('accepts win32 absolute paths when running on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(isAbsoluteLibraryPath('C:\\Users\\bob\\Videos')).toBe(true);
      expect(isAbsoluteLibraryPath('\\\\server\\share')).toBe(true);
    });

    it('rejects relative paths on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(isAbsoluteLibraryPath('Videos\\Movies')).toBe(false);
    });
  });

  describe('isBlockedSystemPath', () => {
    it('blocks exact system directories', () => {
      expect(isBlockedSystemPath('/etc')).toBe(true);
      expect(isBlockedSystemPath('/root')).toBe(true);
      expect(isBlockedSystemPath('/System')).toBe(true);
    });

    it('blocks subpaths of system directories', () => {
      expect(isBlockedSystemPath('/etc/passwd')).toBe(true);
      expect(isBlockedSystemPath('/root/.ssh')).toBe(true);
    });

    it('does not block directories that merely share a prefix', () => {
      // '/etcetera' shares a string prefix with '/etc' but is not inside it
      expect(isBlockedSystemPath('/etcetera')).toBe(false);
    });

    it('allows real media/user directories', () => {
      expect(isBlockedSystemPath('/Volumes/Sigma Setup')).toBe(false);
      expect(isBlockedSystemPath('/mnt/user/media')).toBe(false);
      expect(isBlockedSystemPath('/Users/bob/Movies')).toBe(false);
      expect(isBlockedSystemPath('/home/bob/media')).toBe(false);
    });

    it('does not block the filesystem root itself (browse must be able to reach it)', () => {
      expect(isBlockedSystemPath('/')).toBe(false);
    });

    it('ignores win32-shaped blocklist entries while running on POSIX', () => {
      expect(isBlockedSystemPath('C:\\Windows')).toBe(false);
    });

    it('blocks win32 system directories when running on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(isBlockedSystemPath('C:\\Windows')).toBe(true);
      expect(isBlockedSystemPath('C:\\Windows\\System32')).toBe(true);
      expect(isBlockedSystemPath('C:\\Program Files\\SomeApp')).toBe(true);
    });

    it('is case-insensitive for win32 system directories', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(isBlockedSystemPath('c:\\windows\\system32')).toBe(true);
    });

    it('allows real media directories on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(isBlockedSystemPath('C:\\Users\\bob\\Videos')).toBe(false);
      expect(isBlockedSystemPath('D:\\Media')).toBe(false);
    });
  });
});
