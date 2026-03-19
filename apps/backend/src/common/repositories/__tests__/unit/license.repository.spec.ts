import { Test, type TestingModule } from '@nestjs/testing';
import { LicenseStatus, LicenseTier } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { LicenseRepository } from '../../license.repository';

const mockLicense = {
  id: 'lic-1',
  key: 'KEY-ABC-123',
  tier: LicenseTier.FREE,
  status: LicenseStatus.ACTIVE,
  email: 'user@example.com',
  maxNodes: 1,
  maxConcurrentJobs: 2,
  features: {},
  validUntil: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockPrismaLicense = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  upsert: jest.fn(),
  groupBy: jest.fn(),
};

const mockPrisma = {
  license: mockPrismaLicense,
  $transaction: jest.fn(),
};

describe('LicenseRepository', () => {
  let repository: LicenseRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [LicenseRepository, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    repository = module.get<LicenseRepository>(LicenseRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeInstanceOf(LicenseRepository);
  });

  describe('findById', () => {
    it('should return license when found', async () => {
      mockPrismaLicense.findUnique.mockResolvedValue(mockLicense);

      const result = await repository.findById('lic-1');

      expect(result).toEqual(mockLicense);
      expect(mockPrismaLicense.findUnique).toHaveBeenCalledWith({ where: { id: 'lic-1' } });
    });

    it('should return null when not found', async () => {
      mockPrismaLicense.findUnique.mockResolvedValue(null);

      const result = await repository.findById('ghost');

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithSelect', () => {
    it('should return selected fields only', async () => {
      mockPrismaLicense.findUnique.mockResolvedValue({ id: 'lic-1', status: LicenseStatus.ACTIVE });

      const result = await repository.findByIdWithSelect<{ id: string; status: LicenseStatus }>(
        'lic-1',
        { id: true, status: true }
      );

      expect(result).toEqual({ id: 'lic-1', status: LicenseStatus.ACTIVE });
      expect(mockPrismaLicense.findUnique).toHaveBeenCalledWith({
        where: { id: 'lic-1' },
        select: { id: true, status: true },
      });
    });
  });

  describe('findByKey', () => {
    it('should return license by key', async () => {
      mockPrismaLicense.findUnique.mockResolvedValue(mockLicense);

      const result = await repository.findByKey('KEY-ABC-123');

      expect(result).toEqual(mockLicense);
      expect(mockPrismaLicense.findUnique).toHaveBeenCalledWith({ where: { key: 'KEY-ABC-123' } });
    });

    it('should return null when key not found', async () => {
      mockPrismaLicense.findUnique.mockResolvedValue(null);

      const result = await repository.findByKey('INVALID');

      expect(result).toBeNull();
    });
  });

  describe('findByKeyWithInclude', () => {
    it('should return license with included relations', async () => {
      const withUser = { ...mockLicense, user: { id: 'u-1' } };
      mockPrismaLicense.findUnique.mockResolvedValue(withUser);

      const result = await repository.findByKeyWithInclude<typeof withUser>('KEY-ABC-123', {
        user: true,
      });

      expect(result).toEqual(withUser);
      expect(mockPrismaLicense.findUnique).toHaveBeenCalledWith({
        where: { key: 'KEY-ABC-123' },
        include: { user: true },
      });
    });
  });

  describe('findByEmail', () => {
    it('should return licenses for an email', async () => {
      mockPrismaLicense.findMany.mockResolvedValue([mockLicense]);

      const result = await repository.findByEmail('user@example.com');

      expect(result).toEqual([mockLicense]);
      expect(mockPrismaLicense.findMany).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
    });
  });

  describe('findActive', () => {
    it('should return active licenses', async () => {
      mockPrismaLicense.findMany.mockResolvedValue([mockLicense]);

      const result = await repository.findActive();

      expect(result).toEqual([mockLicense]);
      expect(mockPrismaLicense.findMany).toHaveBeenCalledWith({
        where: { status: LicenseStatus.ACTIVE },
      });
    });
  });

  describe('findFirstActive', () => {
    it('should return first active license', async () => {
      mockPrismaLicense.findFirst.mockResolvedValue(mockLicense);

      const result = await repository.findFirstActive();

      expect(result).toEqual(mockLicense);
      expect(mockPrismaLicense.findFirst).toHaveBeenCalledWith({
        where: { status: LicenseStatus.ACTIVE },
      });
    });

    it('should return null when no active license', async () => {
      mockPrismaLicense.findFirst.mockResolvedValue(null);

      const result = await repository.findFirstActive();

      expect(result).toBeNull();
    });
  });

  describe('findFirstActiveDesc', () => {
    it('should return first active license ordered by createdAt desc', async () => {
      mockPrismaLicense.findFirst.mockResolvedValue(mockLicense);

      const result = await repository.findFirstActiveDesc();

      expect(result).toEqual(mockLicense);
      expect(mockPrismaLicense.findFirst).toHaveBeenCalledWith({
        where: { status: LicenseStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findByTier', () => {
    it('should return licenses for a given tier', async () => {
      mockPrismaLicense.findMany.mockResolvedValue([mockLicense]);

      const result = await repository.findByTier(LicenseTier.FREE);

      expect(result).toEqual([mockLicense]);
      expect(mockPrismaLicense.findMany).toHaveBeenCalledWith({
        where: { tier: LicenseTier.FREE },
      });
    });
  });

  describe('createLicense', () => {
    it('should create a new license', async () => {
      mockPrismaLicense.create.mockResolvedValue(mockLicense);

      const data = {
        key: 'KEY-ABC-123',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        email: 'user@example.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
      };

      const result = await repository.createLicense(data);

      expect(result).toEqual(mockLicense);
      expect(mockPrismaLicense.create).toHaveBeenCalledWith({ data });
    });
  });

  describe('updateById', () => {
    it('should update license by id', async () => {
      const updated = { ...mockLicense, status: LicenseStatus.EXPIRED };
      mockPrismaLicense.update.mockResolvedValue(updated);

      const result = await repository.updateById('lic-1', { status: LicenseStatus.EXPIRED });

      expect(result).toEqual(updated);
      expect(mockPrismaLicense.update).toHaveBeenCalledWith({
        where: { id: 'lic-1' },
        data: { status: LicenseStatus.EXPIRED },
      });
    });
  });

  describe('updateByKey', () => {
    it('should update license by key', async () => {
      const updated = { ...mockLicense, maxNodes: 5 };
      mockPrismaLicense.update.mockResolvedValue(updated);

      const result = await repository.updateByKey('KEY-ABC-123', { maxNodes: 5 });

      expect(result).toEqual(updated);
      expect(mockPrismaLicense.update).toHaveBeenCalledWith({
        where: { key: 'KEY-ABC-123' },
        data: { maxNodes: 5 },
      });
    });
  });

  describe('deleteById', () => {
    it('should delete license by id', async () => {
      mockPrismaLicense.delete.mockResolvedValue(mockLicense);

      const result = await repository.deleteById('lic-1');

      expect(result).toEqual(mockLicense);
      expect(mockPrismaLicense.delete).toHaveBeenCalledWith({ where: { id: 'lic-1' } });
    });
  });

  describe('upsertByEmail', () => {
    it('should upsert license by email', async () => {
      mockPrismaLicense.upsert.mockResolvedValue(mockLicense);

      const createData = {
        key: 'KEY-NEW',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        email: 'user@example.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
      };

      const result = await repository.upsertByEmail(
        'user@example.com',
        { maxNodes: 2 },
        createData
      );

      expect(result).toEqual(mockLicense);
      expect(mockPrismaLicense.upsert).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
        update: { maxNodes: 2 },
        create: createData,
      });
    });
  });

  describe('transactionFindFirstAndUpsert', () => {
    it('should update existing license inside transaction', async () => {
      const txLicense = {
        findFirst: jest.fn().mockResolvedValue(mockLicense),
        update: jest.fn().mockResolvedValue(mockLicense),
        create: jest.fn(),
      };
      const tx = { license: txLicense };
      mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      const result = await repository.transactionFindFirstAndUpsert({
        status: LicenseStatus.ACTIVE,
      });

      expect(result).toEqual(mockLicense);
      expect(txLicense.update).toHaveBeenCalledWith({
        where: { id: mockLicense.id },
        data: { status: LicenseStatus.ACTIVE },
      });
    });

    it('should create license when none exists inside transaction', async () => {
      const txLicense = {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue(mockLicense),
      };
      const tx = { license: txLicense };
      mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      const result = await repository.transactionFindFirstAndUpsert({
        key: 'KEY-NEW',
        email: 'user@example.com',
      });

      expect(result).toEqual(mockLicense);
      expect(txLicense.create).toHaveBeenCalledWith({
        data: { key: 'KEY-NEW', email: 'user@example.com' },
      });
    });
  });

  describe('countByStatus', () => {
    it('should return counts grouped by status', async () => {
      mockPrismaLicense.groupBy.mockResolvedValue([
        { status: LicenseStatus.ACTIVE, _count: 3 },
        { status: LicenseStatus.EXPIRED, _count: 1 },
      ]);

      const result = await repository.countByStatus();

      expect(result[LicenseStatus.ACTIVE]).toBe(3);
      expect(result[LicenseStatus.EXPIRED]).toBe(1);
      expect(mockPrismaLicense.groupBy).toHaveBeenCalledWith({ by: ['status'], _count: true });
    });
  });
});
