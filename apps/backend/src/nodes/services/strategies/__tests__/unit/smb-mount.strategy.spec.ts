import { Test, type TestingModule } from '@nestjs/testing';
import { type StorageShare } from '@prisma/client';
import * as fs from 'fs/promises';
import { EncryptionService } from '../../../../../core/services/encryption.service';
import { SMBMountStrategy } from '../../smb-mount.strategy';

jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('child_process', () => ({ exec: jest.fn() }));
jest.mock('util', () => ({
  promisify:
    (fn: (...args: unknown[]) => void) =>
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        fn(...args, (err: unknown, result: unknown) => {
          if (err) reject(err);
          else resolve(result);
        });
      }),
}));

import { exec } from 'child_process';

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedExec = exec as unknown as jest.Mock;

function makeShare(overrides: Partial<StorageShare> = {}): StorageShare {
  return {
    id: 'share-1',
    nodeId: 'node-1',
    name: 'Test Share',
    protocol: 'SMB',
    serverAddress: '192.168.1.100',
    sharePath: 'media',
    mountPoint: '/mnt/media',
    smbUsername: null,
    smbPassword: null,
    smbDomain: null,
    smbVersion: null,
    mountOptions: null,
    readOnly: false,
    isActive: true,
    isMounted: false,
    lastMountedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as StorageShare;
}

describe('SMBMountStrategy', () => {
  let strategy: SMBMountStrategy;
  let mockEncryptionService: jest.Mocked<EncryptionService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockEncryptionService = {
      isEncrypted: jest.fn().mockReturnValue(false),
      decrypt: jest.fn().mockReturnValue('decrypted-password'),
      encrypt: jest.fn(),
    } as unknown as jest.Mocked<EncryptionService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SMBMountStrategy,
        { provide: EncryptionService, useValue: mockEncryptionService },
      ],
    }).compile();

    strategy = module.get<SMBMountStrategy>(SMBMountStrategy);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('buildMountCommand', () => {
    it('should build basic mount command without credentials', async () => {
      const share = makeShare();

      const cmd = await strategy.buildMountCommand(share);

      expect(cmd).toContain('mount -t cifs');
      expect(cmd).toContain('192.168.1.100');
      expect(cmd).toContain('media');
      expect(cmd).toContain('rw');
    });

    it('should include credentials file when username and password provided', async () => {
      const share = makeShare({ smbUsername: 'user', smbPassword: 'plain-pass' });

      const cmd = await strategy.buildMountCommand(share);

      expect(cmd).toContain('credentials=');
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        `/tmp/smb-creds-${share.id}`,
        'username=user\npassword=plain-pass',
        { mode: 0o600 }
      );
    });

    it('should decrypt encrypted password when isEncrypted returns true', async () => {
      mockEncryptionService.isEncrypted.mockReturnValue(true);
      mockEncryptionService.decrypt.mockReturnValue('decrypted-pass');

      const share = makeShare({ smbUsername: 'user', smbPassword: 'encrypted:xyz' });

      const cmd = await strategy.buildMountCommand(share);

      expect(mockEncryptionService.decrypt).toHaveBeenCalledWith('encrypted:xyz');
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        'username=user\npassword=decrypted-pass',
        expect.any(Object)
      );
      expect(cmd).toContain('credentials=');
    });

    it('should use plain text password when isEncrypted returns false', async () => {
      mockEncryptionService.isEncrypted.mockReturnValue(false);

      const share = makeShare({ smbUsername: 'user', smbPassword: 'plain' });

      await strategy.buildMountCommand(share);

      expect(mockEncryptionService.decrypt).not.toHaveBeenCalled();
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        'username=user\npassword=plain',
        expect.any(Object)
      );
    });

    it('should include domain option when smbDomain is set', async () => {
      const share = makeShare({ smbDomain: 'WORKGROUP' });

      const cmd = await strategy.buildMountCommand(share);

      expect(cmd).toContain('domain=WORKGROUP');
    });

    it('should include version option when smbVersion is set', async () => {
      const share = makeShare({ smbVersion: '3.0' });

      const cmd = await strategy.buildMountCommand(share);

      expect(cmd).toContain('vers=3.0');
    });

    it('should include ro option when readOnly is true', async () => {
      const share = makeShare({ readOnly: true });

      const cmd = await strategy.buildMountCommand(share);

      expect(cmd).toContain('ro');
      expect(cmd).not.toContain('rw');
    });

    it('should include rw option when readOnly is false', async () => {
      const share = makeShare({ readOnly: false });

      const cmd = await strategy.buildMountCommand(share);

      expect(cmd).toContain('rw');
    });

    it('should include custom mount options when mountOptions is set', async () => {
      const share = makeShare({ mountOptions: 'uid=1000,gid=1000' });

      const cmd = await strategy.buildMountCommand(share);

      expect(cmd).toContain('uid=1000');
      expect(cmd).toContain('gid=1000');
    });

    it('should schedule credential file cleanup after 30 seconds', async () => {
      const share = makeShare({ smbUsername: 'user', smbPassword: 'pass' });

      await strategy.buildMountCommand(share);

      expect(mockedFs.unlink).not.toHaveBeenCalled();

      jest.advanceTimersByTime(30000);
      // Let the async unlink settle
      await Promise.resolve();

      expect(mockedFs.unlink).toHaveBeenCalledWith(`/tmp/smb-creds-${share.id}`);
    });

    it('should handle credential file cleanup failure silently', async () => {
      (mockedFs.unlink as jest.Mock).mockRejectedValueOnce(new Error('File not found'));

      const share = makeShare({ smbUsername: 'user', smbPassword: 'pass' });

      await strategy.buildMountCommand(share);
      jest.advanceTimersByTime(30000);
      await Promise.resolve();

      expect(mockedFs.unlink).toHaveBeenCalled();
    });

    it('should strip dangerous characters from sharePath', async () => {
      const share = makeShare({ sharePath: 'media;rm -rf /' });

      const cmd = await strategy.buildMountCommand(share);

      expect(cmd).not.toContain(';');
    });

    it('should not write credentials file when only username is set (no password)', async () => {
      const share = makeShare({ smbUsername: 'user', smbPassword: null });

      await strategy.buildMountCommand(share);

      expect(mockedFs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('buildFstabEntry', () => {
    it('should build basic fstab entry without credentials', async () => {
      const share = makeShare();

      const entry = await strategy.buildFstabEntry(share);

      expect(entry).toContain('cifs');
      expect(entry).toContain('//192.168.1.100/media');
      expect(entry).toContain('/mnt/media');
      expect(entry).toContain('0 0');
    });

    it('should write persistent credentials file for fstab', async () => {
      const share = makeShare({ smbUsername: 'admin', smbPassword: 'secret' });

      const entry = await strategy.buildFstabEntry(share);

      expect(mockedFs.mkdir).toHaveBeenCalledWith('/etc/bitbonsai', {
        recursive: true,
        mode: 0o755,
      });
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        `/etc/bitbonsai/smb-credentials-${share.id}`,
        'username=admin\npassword=secret',
        { mode: 0o600 }
      );
      expect(entry).toContain(`credentials=/etc/bitbonsai/smb-credentials-${share.id}`);
    });

    it('should decrypt encrypted password for fstab entry', async () => {
      mockEncryptionService.isEncrypted.mockReturnValue(true);
      mockEncryptionService.decrypt.mockReturnValue('plain');

      const share = makeShare({ smbUsername: 'u', smbPassword: 'enc:abc' });

      await strategy.buildFstabEntry(share);

      expect(mockEncryptionService.decrypt).toHaveBeenCalledWith('enc:abc');
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        'username=u\npassword=plain',
        expect.any(Object)
      );
    });

    it('should include version in fstab options', async () => {
      const share = makeShare({ smbVersion: '2.1' });

      const entry = await strategy.buildFstabEntry(share);

      expect(entry).toContain('vers=2.1');
    });

    it('should include ro for read-only share in fstab', async () => {
      const share = makeShare({ readOnly: true });

      const entry = await strategy.buildFstabEntry(share);

      expect(entry).toContain('ro');
    });

    it('should include rw for read-write share in fstab', async () => {
      const share = makeShare({ readOnly: false });

      const entry = await strategy.buildFstabEntry(share);

      expect(entry).toContain('rw');
    });

    it('should include custom mountOptions in fstab', async () => {
      const share = makeShare({ mountOptions: 'uid=1000,gid=1000' });

      const entry = await strategy.buildFstabEntry(share);

      expect(entry).toContain('uid=1000');
      expect(entry).toContain('gid=1000');
    });

    it('should not write credentials file when password is null', async () => {
      const share = makeShare({ smbUsername: 'user', smbPassword: null });

      await strategy.buildFstabEntry(share);

      expect(mockedFs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('testConnectivity', () => {
    it('should return true when smbclient succeeds without connection errors', async () => {
      mockedExec.mockImplementation(
        (_cmd: string, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: 'Sharename   Type   Comment\n-------\nmedia   Disk\n', stderr: '' });
        }
      );

      const result = await strategy.testConnectivity('192.168.1.100');

      expect(result).toBe(true);
    });

    it('should return false when smbclient output contains "Connection"', async () => {
      mockedExec.mockImplementation(
        (_cmd: string, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: 'Connection refused', stderr: '' });
        }
      );

      const result = await strategy.testConnectivity('192.168.1.100');

      expect(result).toBe(false);
    });

    it('should return false when smbclient output contains "error"', async () => {
      mockedExec.mockImplementation(
        (_cmd: string, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: 'NT_STATUS_error', stderr: '' });
        }
      );

      const result = await strategy.testConnectivity('192.168.1.100');

      expect(result).toBe(false);
    });

    it('should return false when exec throws', async () => {
      mockedExec.mockImplementation((_cmd: string, cb: (err: Error) => void) => {
        cb(new Error('Command not found: smbclient'));
      });

      const result = await strategy.testConnectivity('192.168.1.100');

      expect(result).toBe(false);
    });
  });
});
