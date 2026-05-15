import { Test, type TestingModule } from '@nestjs/testing';
import { SshKeyService } from '../ssh-key.service';

// Mock node:fs
const mockExistsSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockChmodSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();

jest.mock('node:fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
  chmodSync: (...args: any[]) => mockChmodSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
}));

// Mock node:child_process
const mockSpawn = jest.fn();
jest.mock('node:child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

// Mock node:os
jest.mock('node:os', () => ({
  homedir: () => '/mock/home',
}));

describe('SshKeyService', () => {
  let service: SshKeyService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SshKeyService],
    }).compile();

    service = module.get<SshKeyService>(SshKeyService);
  });

  describe('onModuleInit', () => {
    it('should create .ssh directory if it does not exist', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.endsWith('.ssh')) return false;
        if (path.endsWith('id_rsa.pub')) return true; // Keys exist
        return false;
      });

      await service.onModuleInit();

      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('.ssh'), {
        recursive: true,
      });
      expect(mockChmodSync).toHaveBeenCalledWith(expect.stringContaining('.ssh'), 0o700);
    });

    it('should not create .ssh directory if it already exists', async () => {
      mockExistsSync.mockReturnValue(true);

      await service.onModuleInit();

      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it('should generate keys if public key does not exist', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.endsWith('.ssh')) return true;
        if (path.endsWith('id_rsa.pub')) return false;
        return false;
      });

      // Mock spawn for ssh-keygen
      const mockProcess = createMockChildProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await service.onModuleInit();

      expect(mockSpawn).toHaveBeenCalledWith(
        'ssh-keygen',
        expect.arrayContaining(['-t', 'rsa', '-b', '4096'])
      );
    });

    it('should not generate keys if public key already exists', async () => {
      mockExistsSync.mockReturnValue(true);

      await service.onModuleInit();

      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('getPublicKey', () => {
    it('should return the public key content trimmed', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('ssh-rsa AAAA... comment\n');

      const key = service.getPublicKey();
      expect(key).toBe('ssh-rsa AAAA... comment');
    });

    it('should throw if public key file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() => service.getPublicKey()).toThrow('SSH public key not found');
    });
  });

  describe('addAuthorizedKey', () => {
    const publicKey = 'ssh-rsa AAAA1234 test@host';

    it('should create authorized_keys if it does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      service.addAuthorizedKey(publicKey, 'my-node');

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('authorized_keys'),
        `${publicKey} # my-node\n`,
        { mode: 0o600 }
      );
    });

    it('should append key if authorized_keys exists and key is new', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('ssh-rsa OTHER_KEY old@host\n');

      service.addAuthorizedKey(publicKey);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('authorized_keys'),
        `ssh-rsa OTHER_KEY old@host\n${publicKey}\n`,
        { mode: 0o600 }
      );
    });

    it('should not add duplicate key', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('ssh-rsa AAAA1234 existing@host\n');

      service.addAuthorizedKey(publicKey);

      // writeFileSync should NOT be called for the append
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('should handle key without comment', () => {
      mockExistsSync.mockReturnValue(false);

      service.addAuthorizedKey(publicKey);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('authorized_keys'),
        `${publicKey}\n`,
        { mode: 0o600 }
      );
    });
  });

  describe('removeAuthorizedKey', () => {
    const publicKey = 'ssh-rsa AAAA1234 test@host';

    it('should remove key from authorized_keys', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('ssh-rsa AAAA1234 test@host\nssh-rsa OTHER keep@host\n');

      service.removeAuthorizedKey(publicKey);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('authorized_keys'),
        expect.not.stringContaining('AAAA1234'),
        { mode: 0o600 }
      );
    });

    it('should handle missing authorized_keys file', () => {
      mockExistsSync.mockReturnValue(false);

      // Should not throw
      expect(() => service.removeAuthorizedKey(publicKey)).not.toThrow();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    it('should return true on successful SSH connection', async () => {
      const mockProcess = createMockChildProcess(0, 'SSH_OK');
      mockSpawn.mockReturnValue(mockProcess);

      const result = await service.testConnection('192.168.1.100');

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'ssh',
        expect.arrayContaining([
          '-o',
          'StrictHostKeyChecking=no',
          '-o',
          'BatchMode=yes',
          'root@192.168.1.100',
        ])
      );
    });

    it('should return false on failed SSH connection', async () => {
      const mockProcess = createMockChildProcess(1);
      mockSpawn.mockReturnValue(mockProcess);

      const result = await service.testConnection('192.168.1.100');
      expect(result).toBe(false);
    });

    it('should return false on spawn error', async () => {
      const mockProcess = createMockChildProcess(null, '', new Error('ENOENT'));
      mockSpawn.mockReturnValue(mockProcess);

      const result = await service.testConnection('192.168.1.100');
      expect(result).toBe(false);
    });

    it('should use custom port', async () => {
      const mockProcess = createMockChildProcess(0, 'SSH_OK');
      mockSpawn.mockReturnValue(mockProcess);

      await service.testConnection('192.168.1.100', 2222);

      expect(mockSpawn).toHaveBeenCalledWith('ssh', expect.arrayContaining(['-p', '2222']));
    });
  });

  describe('copyKeyToRemote', () => {
    it('should resolve on successful key copy', async () => {
      const mockProcess = createMockChildProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await expect(
        service.copyKeyToRemote('192.168.1.100', 'ssh-rsa KEY')
      ).resolves.toBeUndefined();
    });

    it('should reject on failed key copy', async () => {
      const mockProcess = createMockChildProcess(1, '', undefined, 'Permission denied');
      mockSpawn.mockReturnValue(mockProcess);

      await expect(service.copyKeyToRemote('192.168.1.100', 'ssh-rsa KEY')).rejects.toThrow(
        'ssh failed with code 1'
      );
    });

    it('should reject on spawn error', async () => {
      const mockProcess = createMockChildProcess(null, '', new Error('ENOENT'));
      mockSpawn.mockReturnValue(mockProcess);

      await expect(service.copyKeyToRemote('192.168.1.100', 'ssh-rsa KEY')).rejects.toThrow(
        'ENOENT'
      );
    });
  });
});

/**
 * Helper to create a mock child process that emits events
 */
function createMockChildProcess(
  exitCode: number | null,
  stdoutData = '',
  spawnError?: Error,
  stderrData = ''
) {
  const stdoutListeners: Record<string, any[]> = {};
  const stderrListeners: Record<string, any[]> = {};
  const processListeners: Record<string, any[]> = {};

  const mockProcess = {
    stdout: {
      on: jest.fn((event: string, cb: any) => {
        if (!stdoutListeners[event]) stdoutListeners[event] = [];
        stdoutListeners[event].push(cb);
      }),
      destroy: jest.fn(),
    },
    stderr: {
      on: jest.fn((event: string, cb: any) => {
        if (!stderrListeners[event]) stderrListeners[event] = [];
        stderrListeners[event].push(cb);
      }),
      destroy: jest.fn(),
    },
    on: jest.fn((event: string, cb: any) => {
      if (!processListeners[event]) processListeners[event] = [];
      processListeners[event].push(cb);
    }),
    kill: jest.fn(),
  };

  // Simulate async events
  setTimeout(() => {
    if (spawnError) {
      for (const cb of processListeners.error ?? []) cb(spawnError);
    } else {
      if (stdoutData) {
        for (const cb of stdoutListeners.data ?? []) cb(Buffer.from(stdoutData));
      }
      if (stderrData) {
        for (const cb of stderrListeners.data ?? []) cb(Buffer.from(stderrData));
      }
      for (const cb of processListeners.close ?? []) cb(exitCode);
    }
  }, 5);

  return mockProcess;
}
