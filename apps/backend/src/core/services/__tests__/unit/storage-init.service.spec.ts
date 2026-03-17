import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { StorageAutoDetectMountEvent } from '../../../../common/events';
import { PrismaService } from '../../../../prisma/prisma.service';
import { NFSAutoExportService } from '../../nfs-auto-export.service';
import { StorageInitService } from '../../storage-init.service';

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn(),
  execFile: jest.fn(),
}));

import { exec } from 'child_process';

const mockExec = exec as unknown as jest.Mock;

function createMockPrisma() {
  return {
    node: {
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    settings: {
      findFirst: jest.fn(),
    },
  };
}

describe('StorageInitService', () => {
  let service: StorageInitService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let nfsAutoExport: { autoExportDockerVolumes: jest.Mock };
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrisma();
    nfsAutoExport = { autoExportDockerVolumes: jest.fn().mockResolvedValue(undefined) };
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageInitService,
        { provide: PrismaService, useValue: prisma },
        { provide: NFSAutoExportService, useValue: nfsAutoExport },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<StorageInitService>(StorageInitService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();

    // Default exec mock
    mockExec.mockImplementation(
      (
        _cmd: string,
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        callback(null, { stdout: '', stderr: '' });
      }
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should schedule initialization with setTimeout', () => {
      jest.useFakeTimers();
      const spy = jest.spyOn(global, 'setTimeout');

      service.onModuleInit();

      expect(spy).toHaveBeenCalledWith(expect.any(Function), 2000);
    });
  });

  describe('initializeStorage (via private method)', () => {
    const callInit = (svc: StorageInitService) => (svc as any).initializeStorage();

    it('should skip when no node found', async () => {
      prisma.node.findFirst.mockResolvedValue(null);

      await callInit(service);

      expect(nfsAutoExport.autoExportDockerVolumes).not.toHaveBeenCalled();
    });

    it('should auto-export volumes for MAIN node', async () => {
      prisma.node.findFirst.mockResolvedValue({ id: 'node-1', role: 'MAIN' });

      await callInit(service);

      expect(nfsAutoExport.autoExportDockerVolumes).toHaveBeenCalled();
    });

    it('should verify NFS mounts for LINKED node with mounts', async () => {
      prisma.node.findFirst.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: 'http://192.168.1.100:3100',
      });
      mockExec.mockImplementation(
        (
          _cmd: string,
          callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          callback(null, {
            stdout: '192.168.1.100:/media on /media type nfs4\n',
            stderr: '',
          });
        }
      );

      await callInit(service);

      expect(prisma.node.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hasSharedStorage: true,
            networkLocation: 'LOCAL',
          }),
        })
      );
    });

    it('should set hasSharedStorage false for LINKED node without NFS mounts', async () => {
      prisma.node.findFirst.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: null,
      });
      mockExec.mockImplementation(
        (
          _cmd: string,
          callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          callback(null, { stdout: '', stderr: '' });
        }
      );

      await callInit(service);

      expect(prisma.node.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hasSharedStorage: false,
          }),
        })
      );
    });

    it('should emit auto-detect event for LINKED node with mainNodeUrl', async () => {
      prisma.node.findFirst.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: 'http://192.168.1.100:3100',
      });
      mockExec.mockImplementation(
        (
          _cmd: string,
          callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          callback(null, { stdout: '', stderr: '' });
        }
      );

      await callInit(service);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        StorageAutoDetectMountEvent.event,
        expect.any(StorageAutoDetectMountEvent)
      );
    });

    it('should handle errors gracefully', async () => {
      prisma.node.findFirst.mockRejectedValue(new Error('DB error'));

      await expect(callInit(service)).resolves.not.toThrow();
    });

    it('should emit event for LINKED node needing auto-detect', async () => {
      prisma.node.findFirst.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: 'http://192.168.1.100:3100',
      });
      mockExec.mockImplementation(
        (
          _cmd: string,
          callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          callback(null, { stdout: '', stderr: '' });
        }
      );

      await callInit(service);

      // Event is emitted; error handling happens in the event listener (StorageShareService)
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        StorageAutoDetectMountEvent.event,
        expect.objectContaining({ nodeId: 'node-2' })
      );
    });
  });
});
