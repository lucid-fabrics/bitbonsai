import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Library, License, Node } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LibrariesService } from './libraries.service';

/**
 * Integration tests for LibrariesService
 *
 * Auto-generated comprehensive tests covering:
 * - Database constraints (foreign keys, unique constraints)
 * - CRUD operations with real database
 * - Data persistence and retrieval
 */
describe('LibrariesService Integration Tests', () => {
  let module: TestingModule;
  let service: LibrariesService;
  let prisma: PrismaService;
  let testLicense: License;
  let testNode: Node;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [LibrariesService, PrismaService],
    }).compile();

    service = module.get<LibrariesService>(LibrariesService);
    prisma = module.get<PrismaService>(PrismaService);

    // Create test fixtures
    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-LIBRARIES',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'libraries@test.com',
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
    await prisma.library.deleteMany({});

    await prisma.node.deleteMany({});
    await prisma.license.deleteMany({});
    await prisma.$disconnect();
    await module.close();
  });

  afterEach(async () => {
    await prisma.library.deleteMany({});
  });

  describe('create', () => {
    it('should create library with valid data', async () => {
      const createDto = {
        name: 'Test Library',
        nodeId: testNode.id,
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

    it('should persist to database', async () => {
      const created = await service.create({
        name: 'Persistent Test',
        nodeId: testNode.id,
      });

      const retrieved = await prisma.library.findUnique({
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
      });
      await service.create({
        name: 'Second',
        nodeId: testNode.id,
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
      });

      const result = await service.findOne(created.id);
      expect(result).toBeDefined();
      expect(result.id).toBe(created.id);
    });

    it('should throw NotFoundException for non-existent id', async () => {
      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update existing record', async () => {
      const created = await service.create({
        name: 'Original',
        nodeId: testNode.id,
      });

      const updated = await service.update(created.id, { name: 'Updated' });
      expect(updated.name).toBe('Updated');
    });

    it('should throw NotFoundException for non-existent id', async () => {
      await expect(service.update('non-existent-id', { name: 'Test' })).rejects.toThrow(
        NotFoundException
      );
    });

    it('should update updatedAt timestamp', async () => {
      const created = await service.create({
        name: 'Test',
        nodeId: testNode.id,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      const updated = await service.update(created.id, { name: 'Updated' });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    });
  });

  describe('remove', () => {
    it('should delete existing record', async () => {
      const created = await service.create({
        name: 'To Delete',
        nodeId: testNode.id,
      });

      await service.remove(created.id);

      const retrieved = await prisma.library.findUnique({
        where: { id: created.id },
      });
      expect(retrieved).toBeNull();
    });

    it('should throw NotFoundException for non-existent id', async () => {
      await expect(service.remove('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });
});
