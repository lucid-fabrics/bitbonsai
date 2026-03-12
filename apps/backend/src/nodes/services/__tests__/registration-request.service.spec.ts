import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AccelerationType, ContainerType, RegistrationRequestStatus } from '@prisma/client';
import { NotificationsGateway } from '../../../notifications/notifications.gateway';
import { NotificationsService } from '../../../notifications/notifications.service';
import { PrismaService } from '../../../prisma/prisma.service';
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
      mockPrisma.nodeRegistrationRequest.findFirst.mockResolvedValue(null);
      const createdRequest = {
        id: 'req-1',
        ...createDto,
        status: RegistrationRequestStatus.PENDING,
        pairingToken: '123456',
      };
      mockPrisma.nodeRegistrationRequest.create.mockResolvedValue(createdRequest);
      mockNotificationsService.createNotification.mockResolvedValue({ id: 'notif-1' });

      const result = await service.createRegistrationRequest(createDto);

      expect(result).toEqual(createdRequest);
      expect(mockPrisma.nodeRegistrationRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          mainNodeId: 'main-1',
          childNodeName: 'Child Node',
          ipAddress: '192.168.1.170',
          hostname: 'child-host',
          macAddress: 'AA:BB:CC:DD:EE:FF',
          containerType: ContainerType.LXC,
        }),
      });
      expect(mockNotificationsGateway.sendToAll).toHaveBeenCalled();
    });

    it('should reset TTL for existing request from same MAC address', async () => {
      const existingRequest = {
        id: 'existing-1',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        status: RegistrationRequestStatus.PENDING,
      };
      mockPrisma.nodeRegistrationRequest.findFirst.mockResolvedValue(existingRequest);
      mockPrisma.nodeRegistrationRequest.update.mockResolvedValue({
        ...existingRequest,
        tokenExpiresAt: new Date(),
      });

      await service.createRegistrationRequest(createDto);

      expect(mockPrisma.nodeRegistrationRequest.update).toHaveBeenCalledWith({
        where: { id: 'existing-1' },
        data: expect.objectContaining({
          status: RegistrationRequestStatus.PENDING,
        }),
      });
      expect(mockPrisma.nodeRegistrationRequest.create).not.toHaveBeenCalled();
    });

    it('should skip duplicate check when macAddress is null', async () => {
      const dtoNoMac = { ...createDto, macAddress: null };
      mockPrisma.nodeRegistrationRequest.create.mockResolvedValue({ id: 'req-1' });
      mockNotificationsService.createNotification.mockResolvedValue({ id: 'n' });

      await service.createRegistrationRequest(dtoNoMac);

      expect(mockPrisma.nodeRegistrationRequest.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.nodeRegistrationRequest.create).toHaveBeenCalled();
    });
  });

  describe('getPendingRequests', () => {
    it('should return pending non-expired requests', async () => {
      const requests = [{ id: 'req-1' }, { id: 'req-2' }];
      mockPrisma.nodeRegistrationRequest.findMany.mockResolvedValue(requests);

      const result = await service.getPendingRequests('main-1');

      expect(result).toEqual(requests);
      expect(mockPrisma.nodeRegistrationRequest.findMany).toHaveBeenCalledWith({
        where: {
          mainNodeId: 'main-1',
          status: RegistrationRequestStatus.PENDING,
          tokenExpiresAt: { gt: expect.any(Date) },
        },
        orderBy: { requestedAt: 'desc' },
      });
    });
  });

  describe('getRequest', () => {
    it('should return a request by ID', async () => {
      const request = {
        id: 'req-1',
        status: RegistrationRequestStatus.PENDING,
        childNodeId: null,
      };
      mockPrisma.nodeRegistrationRequest.findUnique.mockResolvedValue(request);

      const result = await service.getRequest('req-1');
      expect(result).toEqual(request);
    });

    it('should throw NotFoundException when request not found', async () => {
      mockPrisma.nodeRegistrationRequest.findUnique.mockResolvedValue(null);

      await expect(service.getRequest('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should include apiKey when request is APPROVED with childNodeId', async () => {
      const request = {
        id: 'req-1',
        status: RegistrationRequestStatus.APPROVED,
        childNodeId: 'child-1',
      };
      mockPrisma.nodeRegistrationRequest.findUnique.mockResolvedValue(request);
      mockPrisma.node.findUnique.mockResolvedValue({ apiKey: 'bb_secret_key' });

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
      mockPrisma.nodeRegistrationRequest.findUnique.mockResolvedValue(request);

      const result = await service.getRequestByToken('123456');
      expect(result.id).toBe('req-1');
    });

    it('should throw NotFoundException for invalid token', async () => {
      mockPrisma.nodeRegistrationRequest.findUnique.mockResolvedValue(null);

      await expect(service.getRequestByToken('000000')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for expired token', async () => {
      mockPrisma.nodeRegistrationRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        tokenExpiresAt: new Date(Date.now() - 60000), // expired
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
      mockPrisma.nodeRegistrationRequest.findUnique.mockResolvedValue(request);
      mockPrisma.nodeRegistrationRequest.update.mockResolvedValue({
        ...request,
        status: RegistrationRequestStatus.REJECTED,
        rejectionReason: 'Not authorized',
      });

      const result = await service.rejectRequest('req-1', { reason: 'Not authorized' });

      expect(result.status).toBe(RegistrationRequestStatus.REJECTED);
      expect(mockPrisma.nodeRegistrationRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: expect.objectContaining({
          status: RegistrationRequestStatus.REJECTED,
          rejectionReason: 'Not authorized',
        }),
      });
    });

    it('should throw BadRequestException when rejecting non-PENDING request', async () => {
      mockPrisma.nodeRegistrationRequest.findUnique.mockResolvedValue({
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
      mockPrisma.nodeRegistrationRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: RegistrationRequestStatus.PENDING,
        childNodeName: 'Child',
        ipAddress: '1.1.1.1',
      });
      mockPrisma.nodeRegistrationRequest.update.mockResolvedValue({
        id: 'req-1',
        status: RegistrationRequestStatus.CANCELLED,
      });

      const result = await service.cancelRequest('req-1');
      expect(result.status).toBe(RegistrationRequestStatus.CANCELLED);
    });

    it('should throw BadRequestException when cancelling non-PENDING request', async () => {
      mockPrisma.nodeRegistrationRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: RegistrationRequestStatus.REJECTED,
      });

      await expect(service.cancelRequest('req-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cleanupExpiredRequests', () => {
    it('should mark expired PENDING requests as EXPIRED', async () => {
      mockPrisma.nodeRegistrationRequest.updateMany.mockResolvedValue({ count: 3 });

      await service.cleanupExpiredRequests();

      expect(mockPrisma.nodeRegistrationRequest.updateMany).toHaveBeenCalledWith({
        where: {
          status: RegistrationRequestStatus.PENDING,
          tokenExpiresAt: { lt: expect.any(Date) },
        },
        data: {
          status: RegistrationRequestStatus.EXPIRED,
        },
      });
    });

    it('should handle errors gracefully', async () => {
      mockPrisma.nodeRegistrationRequest.updateMany.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await expect(service.cleanupExpiredRequests()).resolves.toBeUndefined();
    });
  });

  describe('deleteOldRequests', () => {
    it('should delete requests older than 30 days', async () => {
      mockPrisma.nodeRegistrationRequest.deleteMany.mockResolvedValue({ count: 5 });

      await service.deleteOldRequests();

      expect(mockPrisma.nodeRegistrationRequest.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: expect.any(Date) },
          status: {
            in: [
              RegistrationRequestStatus.APPROVED,
              RegistrationRequestStatus.REJECTED,
              RegistrationRequestStatus.EXPIRED,
              RegistrationRequestStatus.CANCELLED,
            ],
          },
        },
      });
    });

    it('should handle errors gracefully', async () => {
      mockPrisma.nodeRegistrationRequest.deleteMany.mockRejectedValue(new Error('DB error'));

      await expect(service.deleteOldRequests()).resolves.toBeUndefined();
    });
  });
});
