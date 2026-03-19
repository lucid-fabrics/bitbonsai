import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AccelerationType, ContainerType, RegistrationRequestStatus } from '@prisma/client';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { NotificationsGateway } from '../../../notifications/notifications.gateway';
import { NotificationsService } from '../../../notifications/notifications.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RegistrationRequestRepository } from '../../repositories/registration-request.repository';
import { NodeCapabilityDetectorService } from '../node-capability-detector.service';
import {
  type CreateRegistrationRequestDto,
  RegistrationRequestService,
} from '../registration-request.service';
import { SshKeyService } from '../ssh-key.service';
import { StorageShareService } from '../storage-share.service';
import { SystemInfoService } from '../system-info.service';

describe('RegistrationRequestService', () => {
  let service: RegistrationRequestService;

  const mockPrisma = {
    nodeRegistrationRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    node: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockRegistrationRequestRepository = {
    findFirstByMac: jest.fn(),
    createRequest: jest.fn(),
    updateById: jest.fn(),
    updateManyExpired: jest.fn(),
    deleteManyOld: jest.fn(),
    findManyPending: jest.fn(),
    findUniqueById: jest.fn(),
    findUniqueByToken: jest.fn(),
  };

  const mockNodeRepository = {
    findUnique: jest.fn(),
    findMain: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateData: jest.fn(),
  };

  const mockSystemInfoService = {};
  const mockCapabilityDetector = {
    detectCapabilities: jest.fn(),
  };
  const mockNotificationsService = {
    createNotification: jest.fn(),
  };
  const mockNotificationsGateway = {
    sendToAll: jest.fn(),
  };
  const mockSshKeyService = {
    addAuthorizedKey: jest.fn(),
    getPublicKey: jest.fn(),
  };
  const mockStorageShareService = {
    autoCreateSharesForLibraries: jest.fn(),
  };

  const createDto: CreateRegistrationRequestDto = {
    mainNodeId: 'main-1',
    childNodeName: 'Child Node',
    ipAddress: '192.168.1.170',
    hostname: 'child-host',
    macAddress: 'AA:BB:CC:DD:EE:FF',
    subnet: '192.168.1.0/24',
    containerType: ContainerType.LXC,
    hardwareSpecs: {
      cpuCores: 4,
      cpuModel: 'Intel i7',
      ramGb: 16,
      diskGb: 500,
      gpuModel: null,
    },
    acceleration: AccelerationType.CPU,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistrationRequestService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RegistrationRequestRepository, useValue: mockRegistrationRequestRepository },
        { provide: NodeRepository, useValue: mockNodeRepository },
        { provide: SystemInfoService, useValue: mockSystemInfoService },
        { provide: NodeCapabilityDetectorService, useValue: mockCapabilityDetector },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: NotificationsGateway, useValue: mockNotificationsGateway },
        { provide: SshKeyService, useValue: mockSshKeyService },
        { provide: StorageShareService, useValue: mockStorageShareService },
      ],
    }).compile();

    service = module.get<RegistrationRequestService>(RegistrationRequestService);
  });

  describe('createRegistrationRequest', () => {
    it('should create a new registration request', async () => {
      mockRegistrationRequestRepository.findFirstByMac.mockResolvedValue(null);
      const createdRequest = {
        id: 'req-1',
        ...createDto,
        status: RegistrationRequestStatus.PENDING,
        pairingToken: '123456',
      };
      mockRegistrationRequestRepository.createRequest.mockResolvedValue(createdRequest);
      mockNotificationsService.createNotification.mockResolvedValue({ id: 'notif-1' });

      const result = await service.createRegistrationRequest(createDto);

      expect(result).toEqual(createdRequest);
      expect(mockRegistrationRequestRepository.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          mainNodeId: 'main-1',
          childNodeName: 'Child Node',
          ipAddress: '192.168.1.170',
          hostname: 'child-host',
          macAddress: 'AA:BB:CC:DD:EE:FF',
          containerType: ContainerType.LXC,
        })
      );
      expect(mockNotificationsGateway.sendToAll).toHaveBeenCalled();
    });

    it('should reset TTL for existing request from same MAC address', async () => {
      const existingRequest = {
        id: 'existing-1',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        status: RegistrationRequestStatus.PENDING,
      };
      mockRegistrationRequestRepository.findFirstByMac.mockResolvedValue(existingRequest);
      mockRegistrationRequestRepository.updateById.mockResolvedValue({
        ...existingRequest,
        tokenExpiresAt: new Date(),
      });

      await service.createRegistrationRequest(createDto);

      expect(mockRegistrationRequestRepository.updateById).toHaveBeenCalledWith(
        'existing-1',
        expect.objectContaining({
          status: RegistrationRequestStatus.PENDING,
        })
      );
      expect(mockRegistrationRequestRepository.createRequest).not.toHaveBeenCalled();
    });

    it('should skip duplicate check when macAddress is null', async () => {
      const dtoNoMac = { ...createDto, macAddress: null };
      mockRegistrationRequestRepository.createRequest.mockResolvedValue({ id: 'req-1' });
      mockNotificationsService.createNotification.mockResolvedValue({ id: 'n' });

      await service.createRegistrationRequest(dtoNoMac);

      expect(mockRegistrationRequestRepository.findFirstByMac).not.toHaveBeenCalled();
      expect(mockRegistrationRequestRepository.createRequest).toHaveBeenCalled();
    });
  });

  describe('getPendingRequests', () => {
    it('should return pending non-expired requests', async () => {
      const requests = [{ id: 'req-1' }, { id: 'req-2' }];
      mockRegistrationRequestRepository.findManyPending.mockResolvedValue(requests);

      const result = await service.getPendingRequests('main-1');

      expect(result).toEqual(requests);
      expect(mockRegistrationRequestRepository.findManyPending).toHaveBeenCalledWith('main-1');
    });
  });

  describe('getRequest', () => {
    it('should return a request by ID', async () => {
      const request = {
        id: 'req-1',
        status: RegistrationRequestStatus.PENDING,
        childNodeId: null,
      };
      mockRegistrationRequestRepository.findUniqueById.mockResolvedValue(request);

      const result = await service.getRequest('req-1');
      expect(result).toEqual(request);
    });

    it('should throw NotFoundException when request not found', async () => {
      mockRegistrationRequestRepository.findUniqueById.mockResolvedValue(null);

      await expect(service.getRequest('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should include apiKey when request is APPROVED with childNodeId', async () => {
      const request = {
        id: 'req-1',
        status: RegistrationRequestStatus.APPROVED,
        childNodeId: 'child-1',
      };
      mockRegistrationRequestRepository.findUniqueById.mockResolvedValue(request);
      mockNodeRepository.findUnique.mockResolvedValue({ apiKey: 'bb_secret_key' });

      const result = await service.getRequest('req-1');
      expect((result as any).apiKey).toBe('bb_secret_key');
    });
  });

  describe('getRequestByToken', () => {
    it('should return a request by valid pairing token', async () => {
      const request = {
        id: 'req-1',
        pairingToken: '123456',
        tokenExpiresAt: new Date(Date.now() + 60000),
      };
      mockRegistrationRequestRepository.findUniqueByToken.mockResolvedValue(request);

      const result = await service.getRequestByToken('123456');
      expect(result.id).toBe('req-1');
    });

    it('should throw NotFoundException for invalid token', async () => {
      mockRegistrationRequestRepository.findUniqueByToken.mockResolvedValue(null);

      await expect(service.getRequestByToken('000000')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for expired token', async () => {
      mockRegistrationRequestRepository.findUniqueByToken.mockResolvedValue({
        id: 'req-1',
        tokenExpiresAt: new Date(Date.now() - 60000),
      });

      await expect(service.getRequestByToken('123456')).rejects.toThrow(BadRequestException);
    });
  });

  describe('rejectRequest', () => {
    it('should reject a PENDING request', async () => {
      const request = {
        id: 'req-1',
        status: RegistrationRequestStatus.PENDING,
        childNodeName: 'Child',
        ipAddress: '1.1.1.1',
      };
      mockRegistrationRequestRepository.findUniqueById.mockResolvedValue(request);
      mockRegistrationRequestRepository.updateById.mockResolvedValue({
        ...request,
        status: RegistrationRequestStatus.REJECTED,
        rejectionReason: 'Not authorized',
      });

      const result = await service.rejectRequest('req-1', { reason: 'Not authorized' });

      expect(result.status).toBe(RegistrationRequestStatus.REJECTED);
      expect(mockRegistrationRequestRepository.updateById).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          status: RegistrationRequestStatus.REJECTED,
          rejectionReason: 'Not authorized',
        })
      );
    });

    it('should throw BadRequestException when rejecting non-PENDING request', async () => {
      mockRegistrationRequestRepository.findUniqueById.mockResolvedValue({
        id: 'req-1',
        status: RegistrationRequestStatus.APPROVED,
      });

      await expect(service.rejectRequest('req-1', { reason: 'Too late' })).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe('cancelRequest', () => {
    it('should cancel a PENDING request', async () => {
      mockRegistrationRequestRepository.findUniqueById.mockResolvedValue({
        id: 'req-1',
        status: RegistrationRequestStatus.PENDING,
        childNodeName: 'Child',
        ipAddress: '1.1.1.1',
      });
      mockRegistrationRequestRepository.updateById.mockResolvedValue({
        id: 'req-1',
        status: RegistrationRequestStatus.CANCELLED,
      });

      const result = await service.cancelRequest('req-1');
      expect(result.status).toBe(RegistrationRequestStatus.CANCELLED);
    });

    it('should throw BadRequestException when cancelling non-PENDING request', async () => {
      mockRegistrationRequestRepository.findUniqueById.mockResolvedValue({
        id: 'req-1',
        status: RegistrationRequestStatus.REJECTED,
      });

      await expect(service.cancelRequest('req-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cleanupExpiredRequests', () => {
    it('should mark expired PENDING requests as EXPIRED', async () => {
      mockRegistrationRequestRepository.updateManyExpired.mockResolvedValue({ count: 3 });

      await service.cleanupExpiredRequests();

      expect(mockRegistrationRequestRepository.updateManyExpired).toHaveBeenCalledWith(
        expect.any(Date)
      );
    });

    it('should handle errors gracefully', async () => {
      mockRegistrationRequestRepository.updateManyExpired.mockRejectedValue(new Error('DB error'));

      await expect(service.cleanupExpiredRequests()).resolves.toBeUndefined();
    });
  });

  describe('deleteOldRequests', () => {
    it('should delete requests older than 30 days', async () => {
      mockRegistrationRequestRepository.deleteManyOld.mockResolvedValue({ count: 5 });

      await service.deleteOldRequests();

      expect(mockRegistrationRequestRepository.deleteManyOld).toHaveBeenCalledWith(
        expect.any(Date),
        expect.arrayContaining([
          RegistrationRequestStatus.APPROVED,
          RegistrationRequestStatus.REJECTED,
          RegistrationRequestStatus.EXPIRED,
          RegistrationRequestStatus.CANCELLED,
        ])
      );
    });

    it('should handle errors gracefully', async () => {
      mockRegistrationRequestRepository.deleteManyOld.mockRejectedValue(new Error('DB error'));

      await expect(service.deleteOldRequests()).resolves.toBeUndefined();
    });
  });

  describe('resetRequestTTL', () => {
    it('should update expiry and reset status to PENDING', async () => {
      const updatedRequest = {
        id: 'req-1',
        status: RegistrationRequestStatus.PENDING,
        tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      mockRegistrationRequestRepository.updateById.mockResolvedValue(updatedRequest);

      const result = await service.resetRequestTTL('req-1');

      expect(result).toEqual(updatedRequest);
      expect(mockRegistrationRequestRepository.updateById).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          status: RegistrationRequestStatus.PENDING,
          tokenExpiresAt: expect.any(Date),
          tokenGeneratedAt: expect.any(Date),
          requestedAt: expect.any(Date),
        })
      );
    });
  });

  describe('cancelRequestByToken', () => {
    it('should cancel request found by token', async () => {
      const pendingRequest = {
        id: 'req-token-1',
        pairingToken: '654321',
        tokenExpiresAt: new Date(Date.now() + 60000),
        status: RegistrationRequestStatus.PENDING,
        childNodeName: 'Child',
        ipAddress: '1.2.3.4',
      };
      mockRegistrationRequestRepository.findUniqueByToken.mockResolvedValue(pendingRequest);
      mockRegistrationRequestRepository.findUniqueById.mockResolvedValue(pendingRequest);
      mockRegistrationRequestRepository.updateById.mockResolvedValue({
        ...pendingRequest,
        status: RegistrationRequestStatus.CANCELLED,
      });

      const result = await service.cancelRequestByToken('654321');

      expect(result.status).toBe(RegistrationRequestStatus.CANCELLED);
    });

    it('should throw NotFoundException for invalid token', async () => {
      mockRegistrationRequestRepository.findUniqueByToken.mockResolvedValue(null);

      await expect(service.cancelRequestByToken('000000')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getRequest - apiKey missing from node', () => {
    it('should return request without apiKey when childNode not found', async () => {
      const request = {
        id: 'req-1',
        status: RegistrationRequestStatus.APPROVED,
        childNodeId: 'child-99',
      };
      mockRegistrationRequestRepository.findUniqueById.mockResolvedValue(request);
      mockNodeRepository.findUnique.mockResolvedValue(null);

      const result = await service.getRequest('req-1');

      expect((result as unknown as Record<string, unknown>).apiKey).toBeUndefined();
    });
  });

  describe('cleanupExpiredRequests - no expired', () => {
    it('should not log when no requests expired', async () => {
      mockRegistrationRequestRepository.updateManyExpired.mockResolvedValue({ count: 0 });

      await service.cleanupExpiredRequests();

      expect(mockRegistrationRequestRepository.updateManyExpired).toHaveBeenCalled();
    });
  });

  describe('deleteOldRequests - no deletions', () => {
    it('should not log when count is 0', async () => {
      mockRegistrationRequestRepository.deleteManyOld.mockResolvedValue({ count: 0 });

      await service.deleteOldRequests();

      expect(mockRegistrationRequestRepository.deleteManyOld).toHaveBeenCalled();
    });
  });

  describe('approveRequest', () => {
    const buildTransaction = (
      overrides: Partial<{
        request: unknown;
        mainNode: unknown;
        duplicateNode: unknown;
        newNode: unknown;
      }> = {}
    ) => {
      const defaultRequest = {
        id: 'req-1',
        status: RegistrationRequestStatus.PENDING,
        mainNodeId: 'main-1',
        childNodeName: 'Child',
        ipAddress: '192.168.1.170',
        macAddress: null,
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        acceleration: AccelerationType.CPU,
        childVersion: '1.0.0',
        hardwareSpecs: { cpuCores: 4, ramGb: 16 },
        sshPublicKey: null,
        mainNode: { id: 'main-1' },
      };
      const defaultMainNode = {
        id: 'main-1',
        licenseId: 'license-1',
        license: {
          maxNodes: 10,
          _count: { nodes: 2 },
        },
      };
      const defaultNewNode = {
        id: 'new-node-1',
        apiKey: 'bb_abc123',
        name: 'Child',
      };

      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          nodeRegistrationRequest: {
            findUnique: jest.fn().mockResolvedValue(overrides.request ?? defaultRequest),
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue({
              ...(overrides.request ?? defaultRequest),
              status: RegistrationRequestStatus.APPROVED,
              childNodeId: defaultNewNode.id,
            }),
          },
          node: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce(overrides.mainNode ?? defaultMainNode)
              .mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(overrides.duplicateNode ?? null),
            create: jest.fn().mockResolvedValue(overrides.newNode ?? defaultNewNode),
          },
        };
        return cb(tx);
      });
    };

    it('should throw NotFoundException when request not found', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          nodeRegistrationRequest: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return cb(tx);
      });

      await expect(service.approveRequest('missing')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when request is not PENDING', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          nodeRegistrationRequest: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'req-1',
              status: RegistrationRequestStatus.APPROVED,
              mainNodeId: 'main-1',
              tokenExpiresAt: new Date(Date.now() + 60000),
              mainNode: {},
            }),
          },
        };
        return cb(tx);
      });

      await expect(service.approveRequest('req-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when request is expired', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          nodeRegistrationRequest: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'req-1',
              status: RegistrationRequestStatus.PENDING,
              mainNodeId: 'main-1',
              tokenExpiresAt: new Date(Date.now() - 60000), // expired
              mainNode: {},
            }),
          },
        };
        return cb(tx);
      });

      await expect(service.approveRequest('req-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when main node not found', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          nodeRegistrationRequest: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'req-1',
              status: RegistrationRequestStatus.PENDING,
              mainNodeId: 'main-1',
              tokenExpiresAt: new Date(Date.now() + 60000),
              mainNode: {},
            }),
          },
          node: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return cb(tx);
      });

      await expect(service.approveRequest('req-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when license node limit reached', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          nodeRegistrationRequest: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'req-1',
              status: RegistrationRequestStatus.PENDING,
              mainNodeId: 'main-1',
              tokenExpiresAt: new Date(Date.now() + 60000),
              mainNode: {},
            }),
          },
          node: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'main-1',
              licenseId: 'lic-1',
              license: {
                maxNodes: 2,
                _count: { nodes: 2 },
              },
            }),
            findFirst: jest.fn().mockResolvedValue(null),
          },
        };
        return cb(tx);
      });

      await expect(service.approveRequest('req-1')).rejects.toThrow(
        expect.objectContaining({ message: expect.stringContaining('Maximum nodes') })
      );
    });

    it('should successfully approve and create child node', async () => {
      buildTransaction();

      mockCapabilityDetector.detectCapabilities.mockResolvedValue({
        networkLocation: 'LOCAL',
        hasSharedStorage: false,
        storageBasePath: null,
        latencyMs: 5,
      });
      mockNotificationsService.createNotification.mockResolvedValue({ id: 'notif-2' });
      mockNodeRepository.findMain.mockResolvedValue({ id: 'main-1' });
      mockStorageShareService.autoCreateSharesForLibraries.mockResolvedValue([]);

      const result = await service.approveRequest('req-1');

      expect(result).toBeDefined();
      expect(mockNotificationsGateway.sendToAll).toHaveBeenCalled();
    });

    it('should setup SSH keys when sshPublicKey is present', async () => {
      const requestWithSsh = {
        id: 'req-ssh',
        status: RegistrationRequestStatus.PENDING,
        mainNodeId: 'main-1',
        childNodeName: 'SSH Child',
        ipAddress: '192.168.1.171',
        macAddress: null,
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        acceleration: AccelerationType.CPU,
        childVersion: '1.0.0',
        hardwareSpecs: { cpuCores: 4, ramGb: 16 },
        sshPublicKey: 'ssh-rsa AAAA...publickey child@node',
        mainNode: { id: 'main-1' },
      };

      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          nodeRegistrationRequest: {
            findUnique: jest.fn().mockResolvedValue(requestWithSsh),
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue({
              ...requestWithSsh,
              status: RegistrationRequestStatus.APPROVED,
              childNodeId: 'new-node-ssh',
            }),
          },
          node: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce({
                id: 'main-1',
                licenseId: 'lic-1',
                license: { maxNodes: 10, _count: { nodes: 2 } },
              })
              .mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'new-node-ssh', apiKey: 'bb_sshkey' }),
          },
        };
        return cb(tx);
      });

      mockCapabilityDetector.detectCapabilities.mockResolvedValue({
        networkLocation: 'LOCAL',
        hasSharedStorage: false,
        storageBasePath: null,
        latencyMs: 5,
      });
      mockSshKeyService.getPublicKey.mockReturnValue('ssh-rsa MAIN_PUBLIC_KEY');
      mockNotificationsService.createNotification.mockResolvedValue({ id: 'n-ssh' });
      mockNodeRepository.findMain.mockResolvedValue({ id: 'main-1' });
      mockStorageShareService.autoCreateSharesForLibraries.mockResolvedValue([]);

      const result = await service.approveRequest('req-ssh');

      expect(mockSshKeyService.addAuthorizedKey).toHaveBeenCalledWith(
        'ssh-rsa AAAA...publickey child@node',
        expect.stringContaining('new-node-ssh')
      );
      expect((result as unknown as Record<string, unknown>).mainNodePublicKey).toBe(
        'ssh-rsa MAIN_PUBLIC_KEY'
      );
    });

    it('should mark child node as having shared storage when shares are created', async () => {
      buildTransaction();

      mockCapabilityDetector.detectCapabilities.mockResolvedValue({
        networkLocation: 'LOCAL',
        hasSharedStorage: false,
        storageBasePath: null,
        latencyMs: 5,
      });
      mockNotificationsService.createNotification.mockResolvedValue({ id: 'notif-3' });
      mockNodeRepository.findMain.mockResolvedValue({ id: 'main-1' });
      mockStorageShareService.autoCreateSharesForLibraries.mockResolvedValue([
        { id: 'share-1' },
        { id: 'share-2' },
      ]);
      mockNodeRepository.updateData.mockResolvedValue({ id: 'new-node-1', hasSharedStorage: true });

      await service.approveRequest('req-1');

      expect(mockNodeRepository.updateData).toHaveBeenCalledWith('new-node-1', {
        hasSharedStorage: true,
      });
    });
  });
});
