import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Library, License, Node } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from './queue.service';

/**
 * Integration tests for QueueService
 *
 * Auto-generated comprehensive tests covering:
 * - Database constraints (foreign keys, unique constraints)
 * - CRUD operations with real database
 * - Data persistence and retrieval
 */
describe('QueueService Integration Tests', () => {
  let module: TestingModule;
  let service: QueueService;
  let prisma: PrismaService;
  let testLicense: License;
  let testNode: Node;
  let testLibrary: Library;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [QueueService, PrismaService],
    }).compile();

    service = module.get<QueueService>(QueueService);
    prisma = module.get<PrismaService>(PrismaService);

    // Create test fixtures
    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-QUEUE',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'queue@test.com',
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

    testLibrary = await prisma.library.create({
      data: {
        name: 'Test Library',
        path: '/test/path',
        mediaType: 'MIXED',
        enabled: true,
        totalFiles: 0,
        totalSizeBytes: BigInt(0),
        nodeId: testNode.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.queu.deleteMany({});
    await prisma.library.deleteMany({});
    await prisma.node.deleteMany({});
    await prisma.license.deleteMany({});
    await prisma.$disconnect();
    await module.close();
  });

  afterEach(async () => {
    await prisma.queu.deleteMany({});
  });

  describe('create', () => {
    it('should create queu with valid data', async () => {
      const createDto = {
        name: 'Test Queu',
        nodeId: testNode.id,
        libraryId: testLibrary.id,
      };

      const result = await service.create(createDto);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe(createDto.name);
    });

    it('should throw NotFoundException for non-existent nodeId', async () => {
      await expect(
        service.create({
          name: 'Test',
          nodeId: 'non-existent-id',
        })
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw error for non-existent libraryId', async () => {
      await expect(
        service.create({
          name: 'Test',
          libraryId: 'non-existent-id',
        })
      ).rejects.toThrow();
    });

    it('should persist to database', async () => {
      const created = await service.create({
        name: 'Persistent Test',
        nodeId: testNode.id,
        libraryId: testLibrary.id,
      });

      const retrieved = await prisma.queu.findUnique({
        where: { id: created.id },
      });

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Persistent Test');
    });

    it('should set timestamps correctly', async () => {
      const before = new Date();
      const result = await service.create({
        name: 'Timestamp Test',
        nodeId: testNode.id,
        libraryId: testLibrary.id,
      });
      const after = new Date();

      expect(result.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('findAll', () => {
    it('should return empty array when no records exist', async () => {
      const result = await service.findAll();
      expect(result).toEqual([]);
    });

    it('should return all records', async () => {
      await service.create({
        name: 'First',
        nodeId: testNode.id,
        libraryId: testLibrary.id,
      });
      await service.create({
        name: 'Second',
        nodeId: testNode.id,
        libraryId: testLibrary.id,
      });

      const result = await service.findAll();
      expect(result).toHaveLength(2);
    });
  });

  describe('findOne', () => {
    it('should retrieve record by id', async () => {
      const created = await service.create({
        name: 'Test Record',
        nodeId: testNode.id,
        libraryId: testLibrary.id,
      });

      const result = await service.findOne(created.id);
      expect(result).toBeDefined();
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
        libraryId: testLibrary.id,
      });

      await service.remove(created.id);

      const retrieved = await prisma.queu.findUnique({
        where: { id: created.id },
      });
      expect(retrieved).toBeNull();
    });

    it('should throw NotFoundException for non-existent id', async () => {
      await expect(service.remove('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });
});
