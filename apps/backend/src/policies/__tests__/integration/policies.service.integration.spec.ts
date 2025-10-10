import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Library, License, Node } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PoliciesService } from '../../policies.service';
import { PolicyRepository } from '../../repositories/policy.repository';

/**
 * Integration tests for PoliciesService
 *
 * Tests cover:
 * - CRUD operations with repository pattern
 * - Policy presets and custom configurations
 * - Library associations
 * - Validation constraints
 */
describe('PoliciesService Integration Tests', () => {
  let module: TestingModule;
  let service: PoliciesService;
  let prisma: PrismaService;
  let _repository: PolicyRepository;
  let testLicense: License;
  let testNode: Node;
  let testLibrary: Library;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [PoliciesService, PolicyRepository, PrismaService],
    }).compile();

    service = module.get<PoliciesService>(PoliciesService);
    prisma = module.get<PrismaService>(PrismaService);
    _repository = module.get<PolicyRepository>(PolicyRepository);

    // Create test fixtures
    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-POLICIES',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'policies@test.com',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
      },
    });

    testNode = await prisma.node.create({
      data: {
        name: 'Policies Test Node',
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
        name: 'Policies Test Library',
        path: '/test/policies',
        mediaType: 'MOVIE',
        nodeId: testNode.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.job.deleteMany({});
    await prisma.policy.deleteMany({});
    await prisma.library.deleteMany({});
    await prisma.node.deleteMany({});
    await prisma.license.deleteMany({});
    await prisma.$disconnect();
    await module.close();
  });

  afterEach(async () => {
    await prisma.job.deleteMany({});
    await prisma.policy.deleteMany({});
  });

  describe('create', () => {
    it('should create policy with valid data', async () => {
      const createDto = {
        name: 'Test Policy',
        preset: 'BALANCED_HEVC' as const,
        targetCodec: 'HEVC' as const,
        targetQuality: 23,
        libraryId: testLibrary.id,
      };

      const result = await service.create(createDto);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe(createDto.name);
      expect(result.targetCodec).toBe(createDto.targetCodec);
      expect(result.crf).toBe(createDto.crf);
    });

    it('should throw NotFoundException for non-existent library', async () => {
      await expect(
        service.create({
          name: 'Test',
          preset: 'BALANCED_HEVC' as const,
          targetCodec: 'HEVC' as const,
          targetQuality: 23,
          libraryId: 'non-existent-id',
        })
      ).rejects.toThrow(NotFoundException);
    });

    it('should persist to database', async () => {
      const created = await service.create({
        name: 'Persistent Test',
        preset: 'QUALITY_HEVC' as const,
        targetCodec: 'HEVC' as const,
        targetQuality: 20,
        libraryId: testLibrary.id,
      });

      const retrieved = await prisma.policy.findUnique({
        where: { id: created.id },
      });

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Persistent Test');
    });

    it('should set default values correctly', async () => {
      const result = await service.create({
        name: 'Default Test',
        targetCodec: 'HEVC',
        crf: 23,
        preset: 'BALANCED_HEVC',
        libraryId: testLibrary.id,
      });

      expect(result.enabled).toBe(true); // Default enabled
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should allow custom ffmpeg arguments', async () => {
      const customArgs = '-tune film -x265-params log-level=error';

      const result = await service.create({
        name: 'Custom Args Test',
        targetCodec: 'HEVC',
        crf: 23,
        preset: 'BALANCED_HEVC',
        libraryId: testLibrary.id,
        customFfmpegArgs: customArgs,
      });

      expect(result.customFfmpegArgs).toBe(customArgs);
    });
  });

  describe('findAll', () => {
    it('should return empty array when no policies exist', async () => {
      const result = await service.findAll();
      expect(result).toEqual([]);
    });

    it('should return all policies with library information', async () => {
      await service.create({
        name: 'First Policy',
        targetCodec: 'HEVC',
        crf: 23,
        preset: 'BALANCED_HEVC',
        libraryId: testLibrary.id,
      });

      await service.create({
        name: 'Second Policy',
        targetCodec: 'H264',
        crf: 20,
        preset: 'fast',
        libraryId: testLibrary.id,
      });

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0].library).toBeDefined();
      expect(result[0].library?.name).toBe(testLibrary.name);
    });

    it('should include job counts for policies', async () => {
      const policy = await service.create({
        name: 'Policy with Jobs',
        targetCodec: 'HEVC',
        crf: 23,
        preset: 'BALANCED_HEVC',
        libraryId: testLibrary.id,
      });

      // Create jobs for the policy
      await prisma.job.createMany({
        data: [
          {
            libraryId: testLibrary.id,
            policyId: policy.id,
            filePath: '/test/job1.mp4',
            stage: 'QUEUED',
          },
          {
            libraryId: testLibrary.id,
            policyId: policy.id,
            filePath: '/test/job2.mp4',
            stage: 'COMPLETED',
          },
        ],
      });

      const result = await service.findAll();
      const foundPolicy = result.find((p) => p.id === policy.id);

      expect(foundPolicy).toBeDefined();
      expect(foundPolicy?._count?.jobs).toBe(2);
    });
  });

  describe('findOne', () => {
    it('should retrieve policy by id', async () => {
      const created = await service.create({
        name: 'Test Policy',
        targetCodec: 'HEVC',
        crf: 23,
        preset: 'BALANCED_HEVC',
        libraryId: testLibrary.id,
      });

      const result = await service.findOne(created.id);

      expect(result).toBeDefined();
      expect(result.id).toBe(created.id);
      expect(result.library).toBeDefined();
    });

    it('should throw NotFoundException for non-existent id', async () => {
      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update existing policy', async () => {
      const created = await service.create({
        name: 'Original Name',
        targetCodec: 'HEVC',
        crf: 23,
        preset: 'BALANCED_HEVC',
        libraryId: testLibrary.id,
      });

      const updated = await service.update(created.id, {
        name: 'Updated Name',
        crf: 20,
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.crf).toBe(20);
      expect(updated.targetCodec).toBe('HEVC'); // Unchanged
    });

    it('should throw NotFoundException for non-existent id', async () => {
      await expect(service.update('non-existent-id', { name: 'Test' })).rejects.toThrow(
        NotFoundException
      );
    });

    it('should update updatedAt timestamp', async () => {
      const created = await service.create({
        name: 'Test',
        targetCodec: 'HEVC',
        crf: 23,
        preset: 'BALANCED_HEVC',
        libraryId: testLibrary.id,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      const updated = await service.update(created.id, { name: 'Updated' });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    });
  });

  describe('remove', () => {
    it('should delete existing policy', async () => {
      const created = await service.create({
        name: 'To Delete',
        targetCodec: 'HEVC',
        crf: 23,
        preset: 'BALANCED_HEVC',
        libraryId: testLibrary.id,
      });

      await service.remove(created.id);

      const retrieved = await prisma.policy.findUnique({
        where: { id: created.id },
      });

      expect(retrieved).toBeNull();
    });

    it('should throw NotFoundException for non-existent id', async () => {
      await expect(service.remove('non-existent-id')).rejects.toThrow(NotFoundException);
    });

    it('should cascade delete related jobs', async () => {
      const policy = await service.create({
        name: 'Policy with Jobs',
        targetCodec: 'HEVC',
        crf: 23,
        preset: 'BALANCED_HEVC',
        libraryId: testLibrary.id,
      });

      const job = await prisma.job.create({
        data: {
          libraryId: testLibrary.id,
          policyId: policy.id,
          filePath: '/test/cascade.mp4',
          stage: 'QUEUED',
        },
      });

      await service.remove(policy.id);

      const retrievedJob = await prisma.job.findUnique({
        where: { id: job.id },
      });

      // Job should be deleted due to cascade
      expect(retrievedJob).toBeNull();
    });
  });

  describe('getPresets', () => {
    it('should return list of available presets', async () => {
      const result = await service.getPresets();

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // Check preset structure
      const firstPreset = result[0];
      expect(firstPreset.name).toBeDefined();
      expect(firstPreset.targetCodec).toBeDefined();
      expect(firstPreset.crf).toBeDefined();
      expect(firstPreset.preset).toBeDefined();
    });

    it('should include recommended preset', async () => {
      const result = await service.getPresets();

      const recommendedPreset = result.find((p) => p.recommended === true);
      expect(recommendedPreset).toBeDefined();
    });
  });
});
