import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RegistrationRequestRepository } from '../../registration-request.repository';

const mockRequest = {
  id: 'req-1',
  mainNodeId: 'main-1',
  macAddress: 'AA:BB:CC:DD:EE:FF',
  status: 'PENDING' as const,
  pairingToken: 'token-abc',
  tokenExpiresAt: new Date('2099-01-01'),
  requestedAt: new Date('2025-01-01'),
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockPrismaNodeRegistrationRequest = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  updateMany: jest.fn(),
  deleteMany: jest.fn(),
};

const mockPrisma = {
  nodeRegistrationRequest: mockPrismaNodeRegistrationRequest,
};

describe('RegistrationRequestRepository', () => {
  let repository: RegistrationRequestRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [RegistrationRequestRepository, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    repository = module.get<RegistrationRequestRepository>(RegistrationRequestRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeInstanceOf(RegistrationRequestRepository);
  });

  describe('findFirstByMac', () => {
    it('should return request matching mainNodeId, macAddress, and status', async () => {
      mockPrismaNodeRegistrationRequest.findFirst.mockResolvedValue(mockRequest);

      const result = await repository.findFirstByMac('main-1', 'AA:BB:CC:DD:EE:FF', 'PENDING');

      expect(result).toEqual(mockRequest);
      expect(mockPrismaNodeRegistrationRequest.findFirst).toHaveBeenCalledWith({
        where: { mainNodeId: 'main-1', macAddress: 'AA:BB:CC:DD:EE:FF', status: 'PENDING' },
      });
    });

    it('should return null when no matching request', async () => {
      mockPrismaNodeRegistrationRequest.findFirst.mockResolvedValue(null);

      const result = await repository.findFirstByMac('main-1', 'XX:XX:XX:XX:XX:XX', 'PENDING');

      expect(result).toBeNull();
    });
  });

  describe('createRequest', () => {
    it('should create a new registration request', async () => {
      mockPrismaNodeRegistrationRequest.create.mockResolvedValue(mockRequest);

      const data = {
        mainNodeId: 'main-1',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        pairingToken: 'token-abc',
      };
      const result = await repository.createRequest(data);

      expect(result).toEqual(mockRequest);
      expect(mockPrismaNodeRegistrationRequest.create).toHaveBeenCalledWith({ data });
    });

    it('should propagate errors on create', async () => {
      mockPrismaNodeRegistrationRequest.create.mockRejectedValue(new Error('Unique constraint'));

      await expect(repository.createRequest({ mainNodeId: 'main-1' })).rejects.toThrow(
        'Unique constraint'
      );
    });
  });

  describe('updateById', () => {
    it('should update request by id', async () => {
      const updated = { ...mockRequest, status: 'APPROVED' as const };
      mockPrismaNodeRegistrationRequest.update.mockResolvedValue(updated);

      const result = await repository.updateById('req-1', { status: 'APPROVED' });

      expect(result).toEqual(updated);
      expect(mockPrismaNodeRegistrationRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'APPROVED' },
      });
    });
  });

  describe('updateByPairingToken', () => {
    it('should update request by pairingToken', async () => {
      const updated = { ...mockRequest, status: 'APPROVED' as const };
      mockPrismaNodeRegistrationRequest.update.mockResolvedValue(updated);

      const result = await repository.updateByPairingToken('token-abc', { status: 'APPROVED' });

      expect(result).toEqual(updated);
      expect(mockPrismaNodeRegistrationRequest.update).toHaveBeenCalledWith({
        where: { pairingToken: 'token-abc' },
        data: { status: 'APPROVED' },
      });
    });

    it('should propagate errors when token not found', async () => {
      mockPrismaNodeRegistrationRequest.update.mockRejectedValue(new Error('Record not found'));

      await expect(
        repository.updateByPairingToken('invalid-token', { status: 'APPROVED' })
      ).rejects.toThrow('Record not found');
    });
  });

  describe('findManyPending', () => {
    it('should return pending requests that have not expired', async () => {
      mockPrismaNodeRegistrationRequest.findMany.mockResolvedValue([mockRequest]);

      const result = await repository.findManyPending('main-1');

      expect(result).toEqual([mockRequest]);
      expect(mockPrismaNodeRegistrationRequest.findMany).toHaveBeenCalledWith({
        where: {
          mainNodeId: 'main-1',
          status: 'PENDING',
          tokenExpiresAt: { gt: expect.any(Date) },
        },
        orderBy: { requestedAt: 'desc' },
      });
    });

    it('should return empty array when no pending requests', async () => {
      mockPrismaNodeRegistrationRequest.findMany.mockResolvedValue([]);

      const result = await repository.findManyPending('main-2');

      expect(result).toEqual([]);
    });
  });

  describe('findUniqueById', () => {
    it('should return request with mainNode included', async () => {
      const withNode = { ...mockRequest, mainNode: { id: 'main-1', name: 'Main Node' } };
      mockPrismaNodeRegistrationRequest.findUnique.mockResolvedValue(withNode);

      const result = await repository.findUniqueById('req-1');

      expect(result).toEqual(withNode);
      expect(mockPrismaNodeRegistrationRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        include: { mainNode: true },
      });
    });

    it('should return null when not found', async () => {
      mockPrismaNodeRegistrationRequest.findUnique.mockResolvedValue(null);

      const result = await repository.findUniqueById('ghost');

      expect(result).toBeNull();
    });
  });

  describe('findUniqueByToken', () => {
    it('should return request with mainNode included by token', async () => {
      const withNode = { ...mockRequest, mainNode: { id: 'main-1' } };
      mockPrismaNodeRegistrationRequest.findUnique.mockResolvedValue(withNode);

      const result = await repository.findUniqueByToken('token-abc');

      expect(result).toEqual(withNode);
      expect(mockPrismaNodeRegistrationRequest.findUnique).toHaveBeenCalledWith({
        where: { pairingToken: 'token-abc' },
        include: { mainNode: true },
      });
    });

    it('should return null when token not found', async () => {
      mockPrismaNodeRegistrationRequest.findUnique.mockResolvedValue(null);

      const result = await repository.findUniqueByToken('invalid-token');

      expect(result).toBeNull();
    });
  });

  describe('updateManyExpired', () => {
    it('should mark expired PENDING requests as EXPIRED', async () => {
      const now = new Date();
      mockPrismaNodeRegistrationRequest.updateMany.mockResolvedValue({ count: 2 });

      const result = await repository.updateManyExpired(now);

      expect(result).toEqual({ count: 2 });
      expect(mockPrismaNodeRegistrationRequest.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          tokenExpiresAt: { lt: now },
        },
        data: { status: 'EXPIRED' },
      });
    });

    it('should return count 0 when no expired requests', async () => {
      mockPrismaNodeRegistrationRequest.updateMany.mockResolvedValue({ count: 0 });

      const result = await repository.updateManyExpired(new Date());

      expect(result.count).toBe(0);
    });
  });

  describe('deleteManyOld', () => {
    it('should delete old requests with matching statuses before cutoff date', async () => {
      const before = new Date('2024-01-01');
      mockPrismaNodeRegistrationRequest.deleteMany.mockResolvedValue({ count: 5 });

      const result = await repository.deleteManyOld(before, ['EXPIRED', 'APPROVED'] as never[]);

      expect(result).toEqual({ count: 5 });
      expect(mockPrismaNodeRegistrationRequest.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: before },
          status: { in: ['EXPIRED', 'APPROVED'] },
        },
      });
    });

    it('should return count 0 when nothing to delete', async () => {
      mockPrismaNodeRegistrationRequest.deleteMany.mockResolvedValue({ count: 0 });

      const result = await repository.deleteManyOld(new Date('2020-01-01'), []);

      expect(result.count).toBe(0);
    });
  });
});
