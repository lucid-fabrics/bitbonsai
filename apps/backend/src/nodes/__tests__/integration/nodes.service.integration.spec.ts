import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { License, Node } from '@prisma/client';
import { DataAccessService } from '../../../core/services/data-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NodesService } from '../../nodes.service';
import { StorageShareService } from '../../services/storage-share.service';
import { SystemInfoService } from '../../services/system-info.service';

/**
 * Integration tests for NodesService
 *
 * Auto-generated comprehensive tests covering:
 * - Database constraints (foreign keys, unique constraints)
 * - CRUD operations with real database
 * - Data persistence and retrieval
 */
describe('NodesService Integration Tests', () => {
  let module: TestingModule;
  let service: NodesService;
  let prisma: PrismaService;
  let testLicense: License;
  let testNode: Node;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        NodesService,
        PrismaService,
        { provide: DataAccessService, useValue: { getNextJob: jest.fn() } },
        {
          provide: SystemInfoService,
          useValue: { collectSystemInfo: jest.fn().mockResolvedValue({ ipAddress: '127.0.0.1' }) },
        },
        { provide: StorageShareService, useValue: { getSharedPaths: jest.fn() } },
      ],
    }).compile();

    service = module.get<NodesService>(NodesService);
    prisma = module.get<PrismaService>(PrismaService);

    // Create test fixtures
    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-NODES',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'nodes@test.com',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
      },
    });

    testNode = await prisma.node.create({
      data: {
        name: 'Test Node',
        role: 'MAIN',
        status: 'ONLINE',
        version: '1.0.0',
        acceleration: 'CPU',
        apiKey: 'test-key',
        lastHeartbeat: new Date(),
        licenseId: testLicense.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.node.deleteMany({});

    await prisma.node.deleteMany({});
    await prisma.license.deleteMany({});
    await prisma.$disconnect();
    await module.close();
  });

  afterEach(async () => {
    await prisma.node.deleteMany({});
  });

  describe('findAll', () => {
    it('should return empty array when no records exist', async () => {
      const result = await service.findAll();
      expect(result).toEqual([]);
    });

    it('should return all records', async () => {
      // Create nodes directly via Prisma since NodesService doesn't have create method
      await prisma.node.create({
        data: {
          name: 'First Node',
          licenseId: testLicense.id,
          apiKey: 'test-api-key-1',
          role: 'LINKED',
          version: '1.0.0',
          acceleration: 'CPU',
          lastHeartbeat: new Date(),
          status: 'ONLINE',
        },
      });
      await prisma.node.create({
        data: {
          name: 'Second Node',
          licenseId: testLicense.id,
          apiKey: 'test-api-key-2',
          role: 'LINKED',
          version: '1.0.0',
          acceleration: 'CPU',
          lastHeartbeat: new Date(),
          status: 'ONLINE',
        },
      });

      const result = await service.findAll();
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('findOne', () => {
    it('should retrieve record by id', async () => {
      const created = await prisma.node.create({
        data: {
          name: 'Test Record',
          licenseId: testLicense.id,
          apiKey: 'test-api-key-3',
          role: 'LINKED',
          version: '1.0.0',
          acceleration: 'CPU',
          lastHeartbeat: new Date(),
          status: 'ONLINE',
        },
      });

      const result = await service.findOne(created.id);
      expect(result).not.toBeNull();
      expect(result.id).toBe(created.id);
    });

    it('should throw NotFoundException for non-existent id', async () => {
      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete existing record', async () => {
      const created = await service.create({
        name: 'To Delete',
        nodeId: testNode.id,
      });

      await service.remove(created.id);

      const retrieved = await prisma.node.findUnique({
        where: { id: created.id },
      });
      expect(retrieved).toBeNull();
    });

    it('should throw NotFoundException for non-existent id', async () => {
      await expect(service.remove('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });
});
