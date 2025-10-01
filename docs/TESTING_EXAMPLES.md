# Testing Examples for BitBonsai

> **Companion document to**: [TESTING_GUIDELINES.md](./TESTING_GUIDELINES.md)
> **Purpose**: Complete, working test examples from the BitBonsai codebase

## Table of Contents

1. [Complete Service Test Example](#complete-service-test-example)
2. [Complete Controller Test Example](#complete-controller-test-example)
3. [Complex Service with Multiple Dependencies](#complex-service-with-multiple-dependencies)
4. [Testing Child Processes (FFmpeg)](#testing-child-processes-ffmpeg)
5. [Before/After Refactoring Examples](#beforeafter-refactoring-examples)
6. [Common Bug Fixes](#common-bug-fixes)
7. [Advanced Patterns](#advanced-patterns)

---

## Complete Service Test Example

### LicenseService - Full Test Suite

**File**: `apps/backend/src/license/license.service.spec.ts`

```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { LicenseStatus, LicenseTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLicenseDto } from './dto/create-license.dto';
import { LicenseService } from './license.service';

describe('LicenseService', () => {
  let service: LicenseService;
  let prisma: PrismaService;

  const mockPrismaService = {
    license: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<LicenseService>(LicenseService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('validateLicense', () => {
    it('should return valid license details when license is active and not expired', async () => {
      const mockLicense = {
        id: 'license-123',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        validUntil: null,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {
          multiNode: false,
          advancedPresets: false,
          api: false,
          priorityQueue: false,
          cloudStorage: false,
          webhooks: false,
        },
        email: 'test@example.com',
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
        _count: {
          nodes: 0,
        },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.validateLicense('FRE-test123');

      expect(result).toEqual({
        id: 'license-123',
        key: 'FRE-test123',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        validUntil: null,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: mockLicense.features,
        email: 'test@example.com',
        createdAt: mockLicense.createdAt,
        updatedAt: mockLicense.updatedAt,
        canAddNode: true,
        activeNodes: 0,
      });

      expect(mockPrismaService.license.findUnique).toHaveBeenCalledWith({
        where: { key: 'FRE-test123' },
        select: expect.any(Object),
      });
    });

    it('should throw NotFoundException when license does not exist', async () => {
      mockPrismaService.license.findUnique.mockResolvedValue(null);

      await expect(service.validateLicense('INVALID-KEY')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when license is not active', async () => {
      const mockLicense = {
        id: 'license-123',
        status: LicenseStatus.REVOKED,
        validUntil: null,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        _count: { nodes: 0 },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      await expect(service.validateLicense('REV-test123')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when license has expired', async () => {
      const expiredDate = new Date('2024-01-01');
      const mockLicense = {
        id: 'license-123',
        status: LicenseStatus.ACTIVE,
        validUntil: expiredDate,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        _count: { nodes: 0 },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      await expect(service.validateLicense('EXP-test123')).rejects.toThrow(BadRequestException);
    });

    it('should set canAddNode to false when max nodes reached', async () => {
      const mockLicense = {
        id: 'license-123',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        validUntil: null,
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: {
          nodes: 1,
        },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.validateLicense('FRE-test123');

      expect(result.canAddNode).toBe(false);
      expect(result.activeNodes).toBe(1);
    });
  });

  describe('createLicense', () => {
    it('should create a FREE tier license with correct configuration', async () => {
      const createDto: CreateLicenseDto = {
        tier: LicenseTier.FREE,
        email: 'free@example.com',
      };

      const mockCreatedLicense = {
        id: 'license-456',
        key: 'FRE-abcd1234',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        email: 'free@example.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {
          multiNode: false,
          advancedPresets: false,
          api: false,
          priorityQueue: false,
          cloudStorage: false,
          webhooks: false,
        },
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.license.create.mockResolvedValue(mockCreatedLicense);

      const result = await service.createLicense(createDto);

      expect(result).toEqual(mockCreatedLicense);
      expect(mockPrismaService.license.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tier: LicenseTier.FREE,
          email: 'free@example.com',
          maxNodes: 1,
          maxConcurrentJobs: 2,
          status: LicenseStatus.ACTIVE,
        }),
      });
    });

    it('should create a PATREON tier license with advanced features', async () => {
      const createDto: CreateLicenseDto = {
        tier: LicenseTier.PATREON,
        email: 'patreon@example.com',
      };

      const mockCreatedLicense = {
        id: 'license-789',
        key: 'PAT-xyz9876',
        tier: LicenseTier.PATREON,
        status: LicenseStatus.ACTIVE,
        email: 'patreon@example.com',
        maxNodes: 2,
        maxConcurrentJobs: 5,
        features: {
          multiNode: true,
          advancedPresets: true,
          api: true,
          priorityQueue: false,
          cloudStorage: false,
          webhooks: false,
        },
        validUntil: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.license.create.mockResolvedValue(mockCreatedLicense);

      const result = await service.createLicense(createDto);

      expect(result.features).toEqual(
        expect.objectContaining({
          multiNode: true,
          advancedPresets: true,
          api: true,
        })
      );
      expect(result.maxNodes).toBe(2);
      expect(result.maxConcurrentJobs).toBe(5);
    });

    it('should create a COMMERCIAL_PRO license with all features', async () => {
      const createDto: CreateLicenseDto = {
        tier: LicenseTier.COMMERCIAL_PRO,
        email: 'enterprise@example.com',
        validUntil: '2026-12-31T23:59:59.999Z',
      };

      const mockCreatedLicense = {
        id: 'license-999',
        key: 'COM-pro12345',
        tier: LicenseTier.COMMERCIAL_PRO,
        status: LicenseStatus.ACTIVE,
        email: 'enterprise@example.com',
        maxNodes: 20,
        maxConcurrentJobs: 50,
        features: {
          multiNode: true,
          advancedPresets: true,
          api: true,
          priorityQueue: true,
          cloudStorage: true,
          webhooks: true,
        },
        validUntil: new Date('2026-12-31T23:59:59.999Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.license.create.mockResolvedValue(mockCreatedLicense);

      const result = await service.createLicense(createDto);

      expect(result.features).toEqual(
        expect.objectContaining({
          priorityQueue: true,
          cloudStorage: true,
          webhooks: true,
        })
      );
      expect(result.maxNodes).toBe(20);
    });
  });

  describe('checkCanAddNode', () => {
    it('should return true when node count is below max', async () => {
      const mockLicense = {
        maxNodes: 5,
        _count: {
          nodes: 3,
        },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.checkCanAddNode('license-123');

      expect(result).toBe(true);
    });

    it('should return false when node count equals max', async () => {
      const mockLicense = {
        maxNodes: 1,
        _count: {
          nodes: 1,
        },
      };

      mockPrismaService.license.findUnique.mockResolvedValue(mockLicense);

      const result = await service.checkCanAddNode('license-123');

      expect(result).toBe(false);
    });

    it('should throw NotFoundException when license does not exist', async () => {
      mockPrismaService.license.findUnique.mockResolvedValue(null);

      await expect(service.checkCanAddNode('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });
});
```

**Key Takeaways:**
- Mock PrismaService completely for unit tests
- Test all code paths: success, errors, edge cases
- Use descriptive test names that explain expected behavior
- Clear mocks in `beforeEach` for test isolation
- Test business logic validation (license expiry, max nodes)

---

## Complete Controller Test Example

### LibrariesController - Full Test Suite

**File**: `apps/backend/src/libraries/libraries.controller.spec.ts`

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { MediaType } from '@prisma/client';
import { LibrariesController } from './libraries.controller';
import { LibrariesService } from './libraries.service';

describe('LibrariesController', () => {
  let controller: LibrariesController;
  let service: LibrariesService;

  const mockLibrary = {
    id: 'lib-1',
    name: 'Movie Collection',
    path: '/mnt/user/media/Movies',
    mediaType: MediaType.MOVIE,
    enabled: true,
    lastScanAt: null,
    totalFiles: 0,
    totalSizeBytes: BigInt(0),
    nodeId: 'node-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockLibraryStats = {
    ...mockLibrary,
    node: {
      id: 'node-1',
      name: 'Main Server',
      status: 'ONLINE',
    },
    policies: [
      {
        id: 'policy-1',
        name: 'Balanced HEVC',
        preset: 'BALANCED_HEVC',
      },
    ],
    _count: {
      jobs: 42,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LibrariesController],
      providers: [
        {
          provide: LibrariesService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            scan: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<LibrariesController>(LibrariesController);
    service = module.get<LibrariesService>(LibrariesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a library', async () => {
      const createDto = {
        name: 'Movie Collection',
        path: '/mnt/user/media/Movies',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };

      jest.spyOn(service, 'create').mockResolvedValue(mockLibrary as any);

      const result = await controller.create(createDto);

      expect(result).toEqual(mockLibrary);
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('findAll', () => {
    it('should return all libraries', async () => {
      const mockLibraries = [mockLibrary];
      jest.spyOn(service, 'findAll').mockResolvedValue(mockLibraries as any);

      const result = await controller.findAll();

      expect(result).toEqual(mockLibraries);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a library with statistics', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(mockLibraryStats as any);

      const result = await controller.findOne('lib-1');

      expect(result).toEqual(mockLibraryStats);
      expect(service.findOne).toHaveBeenCalledWith('lib-1');
    });
  });

  describe('update', () => {
    it('should update a library', async () => {
      const updateDto = {
        name: 'Updated Movie Collection',
        enabled: false,
      };
      const updatedLibrary = { ...mockLibrary, ...updateDto };

      jest.spyOn(service, 'update').mockResolvedValue(updatedLibrary as any);

      const result = await controller.update('lib-1', updateDto);

      expect(result).toEqual(updatedLibrary);
      expect(service.update).toHaveBeenCalledWith('lib-1', updateDto);
    });
  });

  describe('remove', () => {
    it('should delete a library', async () => {
      jest.spyOn(service, 'remove').mockResolvedValue(undefined);

      await controller.remove('lib-1');

      expect(service.remove).toHaveBeenCalledWith('lib-1');
    });
  });

  describe('scan', () => {
    it('should trigger a library scan', async () => {
      const scannedLibrary = {
        ...mockLibrary,
        lastScanAt: new Date(),
      };

      jest.spyOn(service, 'scan').mockResolvedValue(scannedLibrary as any);

      const result = await controller.scan('lib-1');

      expect(result).toEqual(scannedLibrary);
      expect(service.scan).toHaveBeenCalledWith('lib-1');
    });
  });
});
```

**Key Takeaways:**
- Controllers should only test HTTP layer logic
- Mock the entire service layer
- Verify service methods are called with correct parameters
- Test all CRUD operations
- Test response transformation

---

## Complex Service with Multiple Dependencies

### InsightsService - Service with Aggregation Logic

**File**: `apps/backend/src/insights/insights.service.spec.ts`

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import type { AccelerationType, NodeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InsightsService } from './insights.service';

describe('InsightsService', () => {
  let service: InsightsService;
  let prisma: PrismaService;

  const mockMetrics = [
    {
      id: 'metric1',
      date: new Date('2024-09-30T00:00:00Z'),
      nodeId: 'node1',
      licenseId: 'license1',
      jobsCompleted: 42,
      jobsFailed: 1,
      totalSavedBytes: BigInt(5368709120), // 5 GB
      avgThroughputFilesPerHour: 12.5,
      codecDistribution: { 'H.264': 25, HEVC: 15, AV1: 2 },
      createdAt: new Date('2024-09-30T23:59:59Z'),
    },
    {
      id: 'metric2',
      date: new Date('2024-10-01T00:00:00Z'),
      nodeId: 'node1',
      licenseId: 'license1',
      jobsCompleted: 38,
      jobsFailed: 2,
      totalSavedBytes: BigInt(6442450944), // 6 GB
      avgThroughputFilesPerHour: 11.3,
      codecDistribution: { 'H.264': 22, HEVC: 14, AV1: 2 },
      createdAt: new Date('2024-10-01T23:59:59Z'),
    },
  ];

  const mockPrismaService = {
    metric: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    node: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InsightsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<InsightsService>(InsightsService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('getAggregatedStats', () => {
    it('should calculate aggregated statistics', async () => {
      mockPrismaService.metric.aggregate.mockResolvedValue({
        _sum: {
          jobsCompleted: 80,
          jobsFailed: 3,
          totalSavedBytes: BigInt(11811160064), // 11 GB
        },
        _avg: {
          avgThroughputFilesPerHour: 11.9,
        },
      });

      const result = await service.getAggregatedStats();

      expect(result).toMatchObject({
        totalJobsCompleted: 80,
        totalJobsFailed: 3,
        totalSavedBytes: '11811160064',
        totalSavedGB: 11.0,
        avgThroughput: 11.9,
        successRate: 96.39,
      });
      expect(result.timestamp).toBeDefined();
    });

    it('should handle zero values', async () => {
      mockPrismaService.metric.aggregate.mockResolvedValue({
        _sum: {
          jobsCompleted: 0,
          jobsFailed: 0,
          totalSavedBytes: BigInt(0),
        },
        _avg: {
          avgThroughputFilesPerHour: 0,
        },
      });

      const result = await service.getAggregatedStats();

      expect(result).toMatchObject({
        totalJobsCompleted: 0,
        totalJobsFailed: 0,
        totalSavedBytes: '0',
        totalSavedGB: 0,
        avgThroughput: 0,
        successRate: 0,
      });
    });
  });

  describe('getCodecDistribution', () => {
    it('should calculate codec distribution from metrics', async () => {
      mockPrismaService.metric.findMany.mockResolvedValue(mockMetrics);

      const result = await service.getCodecDistribution();

      expect(result.distribution).toHaveLength(3);
      expect(result.totalFiles).toBe(80); // Sum of all codec counts
      expect(result.distribution[0].codec).toBe('H.264');
      expect(result.distribution[0].count).toBe(47); // 25 + 22
      expect(result.distribution[0].percentage).toBeCloseTo(58.75, 1);
    });

    it('should handle empty metrics', async () => {
      mockPrismaService.metric.findMany.mockResolvedValue([]);

      const result = await service.getCodecDistribution();

      expect(result.distribution).toEqual([]);
      expect(result.totalFiles).toBe(0);
    });

    it('should sort by count descending', async () => {
      mockPrismaService.metric.findMany.mockResolvedValue(mockMetrics);

      const result = await service.getCodecDistribution();

      // Should be sorted: H.264 (47), HEVC (29), AV1 (4)
      expect(result.distribution[0].count).toBeGreaterThanOrEqual(
        result.distribution[1].count
      );
      expect(result.distribution[1].count).toBeGreaterThanOrEqual(
        result.distribution[2].count
      );
    });
  });
});
```

**Key Takeaways:**
- Test aggregation and calculation logic
- Handle BigInt values (convert to string for assertions)
- Test edge cases (zero values, empty arrays)
- Test sorting and ordering logic
- Verify percentage calculations

---

## Testing Child Processes (FFmpeg)

### FfmpegService - Comprehensive Test Suite

**File**: `apps/backend/src/encoding/ffmpeg.service.spec.ts` (excerpt)

```typescript
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Test, type TestingModule } from '@nestjs/testing';
import { FfmpegService } from './ffmpeg.service';

// Mock child_process module
jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

// Mock fs module
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  promises: {
    stat: jest.fn(),
    rename: jest.fn(),
    unlink: jest.fn(),
  },
}));

describe('FfmpegService', () => {
  let service: FfmpegService;
  let mockSpawn: jest.Mock;
  let mockFs: {
    existsSync: jest.Mock;
    stat: jest.Mock;
    rename: jest.Mock;
    unlink: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const childProcess = await import('node:child_process');
    mockSpawn = childProcess.spawn as jest.Mock;

    const fs = await import('node:fs');
    mockFs = {
      existsSync: fs.existsSync as jest.Mock,
      stat: fs.promises.stat as jest.Mock,
      rename: fs.promises.rename as jest.Mock,
      unlink: fs.promises.unlink as jest.Mock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FfmpegService],
    }).compile();

    service = module.get<FfmpegService>(FfmpegService);

    // Default mock implementations
    mockFs.existsSync.mockReturnValue(true);
    mockFs.stat.mockResolvedValue({ size: 500000000 } as never);
    mockFs.rename.mockResolvedValue(undefined as never);
    mockFs.unlink.mockResolvedValue(undefined as never);
  });

  describe('encodeFile', () => {
    it('should successfully encode file and complete job', async () => {
      // Mock hardware acceleration detection
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });

      // Create mock ffmpeg process with proper stderr
      const stderrEmitter = new EventEmitter();
      const mockProcess = new EventEmitter() as ChildProcess;
      (mockProcess as any).stderr = stderrEmitter;
      mockSpawn.mockReturnValue(mockProcess);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      // Simulate progress updates
      setTimeout(() => {
        stderrEmitter.emit(
          'data',
          Buffer.from('frame= 1000 fps= 50.0 time=00:00:30.00\n')
        );
      }, 10);

      // Simulate successful completion
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 20);

      await encodePromise;

      expect(mockFs.rename).toHaveBeenCalledWith(
        '/media/video.mp4.tmp',
        '/media/video.mp4'
      );
    });

    it('should handle encoding failure', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });

      const stderrEmitter = new EventEmitter();
      const mockProcess = new EventEmitter() as ChildProcess;
      (mockProcess as any).stderr = stderrEmitter;
      mockSpawn.mockReturnValue(mockProcess);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      // Simulate failure
      setTimeout(() => {
        mockProcess.emit('close', 1);
      }, 10);

      await expect(encodePromise).rejects.toThrow('ffmpeg exited with code 1');
      expect(mockFs.unlink).toHaveBeenCalledWith('/media/video.mp4.tmp');
    });

    it('should handle process spawn error', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });

      const stderrEmitter = new EventEmitter();
      const mockProcess = new EventEmitter() as ChildProcess;
      (mockProcess as any).stderr = stderrEmitter;
      mockSpawn.mockReturnValue(mockProcess);

      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      // Simulate spawn error
      setTimeout(() => {
        mockProcess.emit('error', new Error('spawn ffmpeg ENOENT'));
      }, 10);

      await expect(encodePromise).rejects.toThrow('spawn ffmpeg ENOENT');
    });
  });

  describe('cancelEncoding', () => {
    it('should cancel active encoding', async () => {
      jest.spyOn(service, 'detectHardwareAcceleration').mockResolvedValue({
        type: 'CPU',
        flags: [],
        videoCodec: 'libx265',
      });

      const stderrEmitter = new EventEmitter();
      const mockProcess = new EventEmitter() as ChildProcess;
      (mockProcess as any).stderr = stderrEmitter;
      (mockProcess as any).kill = jest.fn();
      (mockProcess as any).killed = false;
      mockSpawn.mockReturnValue(mockProcess);

      // Start encoding (don't await - we want it running)
      const encodePromise = service.encodeFile(mockJob, mockPolicy);

      // Wait for encoding to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Cancel the encoding
      const cancelPromise = service.cancelEncoding(mockJob.id);

      // Simulate process killed
      setTimeout(() => {
        (mockProcess as any).killed = true;
      }, 10);

      const result = await cancelPromise;

      expect(result).toBe(true);
      expect((mockProcess as any).kill).toHaveBeenCalledWith('SIGTERM');

      // Clean up
      setTimeout(() => mockProcess.emit('close', 1), 10);
      await encodePromise.catch(() => {});
    });
  });
});
```

**Key Takeaways:**
- Mock `child_process.spawn` to avoid spawning real processes
- Use EventEmitter to simulate process events (`close`, `error`)
- Mock stderr stream for progress parsing
- Use setTimeout to simulate async process events
- Test both success and failure paths
- Test cancellation and cleanup logic

---

## Before/After Refactoring Examples

### Example 1: Improving Test Isolation

#### Before (Shared State Problem)

```typescript
// ❌ BAD - Shared state between tests
describe('UserService', () => {
  const mockUsers = [{ id: '1', name: 'John' }];

  const mockPrismaService = {
    user: {
      findMany: jest.fn().mockResolvedValue(mockUsers),
    },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should return all users', async () => {
    const users = await service.findAll();
    expect(users).toEqual(mockUsers);
  });

  it('should filter users', async () => {
    // This test modifies shared mockUsers array!
    mockUsers.push({ id: '2', name: 'Jane' });

    const users = await service.findAll();
    expect(users).toHaveLength(2); // Now depends on previous test
  });
});
```

#### After (Proper Isolation)

```typescript
// ✅ GOOD - Fresh mocks for each test
describe('UserService', () => {
  let service: UserService;
  let mockPrismaService: {
    user: {
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockPrismaService = {
      user: {
        findMany: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    jest.clearAllMocks();
  });

  it('should return all users', async () => {
    const mockUsers = [{ id: '1', name: 'John' }];
    mockPrismaService.user.findMany.mockResolvedValue(mockUsers);

    const users = await service.findAll();
    expect(users).toEqual(mockUsers);
  });

  it('should filter users', async () => {
    const mockUsers = [
      { id: '1', name: 'John' },
      { id: '2', name: 'Jane' },
    ];
    mockPrismaService.user.findMany.mockResolvedValue(mockUsers);

    const users = await service.findAll();
    expect(users).toHaveLength(2);
  });
});
```

### Example 2: Testing Async Operations Properly

#### Before (Missing await)

```typescript
// ❌ BAD - Missing await, test passes even if method fails
it('should update user', () => {
  service.updateUser('1', { name: 'Updated' });
  expect(mockPrismaService.user.update).toHaveBeenCalled();
});
```

#### After (Proper async/await)

```typescript
// ✅ GOOD - Proper async handling
it('should update user', async () => {
  mockPrismaService.user.update.mockResolvedValue({
    id: '1',
    name: 'Updated',
  });

  const result = await service.updateUser('1', { name: 'Updated' });

  expect(result.name).toBe('Updated');
  expect(mockPrismaService.user.update).toHaveBeenCalledWith({
    where: { id: '1' },
    data: { name: 'Updated' },
  });
});
```

---

## Common Bug Fixes

### Bug 1: Mock Not Being Called

```typescript
// Problem: Mock function not called
it('should trigger callback', () => {
  const callback = jest.fn();
  service.setCallback(jest.fn()); // Different instance!

  service.execute();

  expect(callback).toHaveBeenCalled(); // Fails!
});

// Solution: Use same reference
it('should trigger callback', () => {
  const callback = jest.fn();
  service.setCallback(callback); // Same instance

  service.execute();

  expect(callback).toHaveBeenCalled(); // Passes
});
```

### Bug 2: Test Timeout Issues

```typescript
// Problem: Test times out
it('should emit event', (done) => {
  service.on('event', () => {
    expect(true).toBe(true);
    // Missing done() call - test never completes!
  });
  service.trigger();
});

// Solution: Always call done()
it('should emit event', (done) => {
  service.on('event', () => {
    expect(true).toBe(true);
    done(); // Completes test
  });
  service.trigger();
});

// Or use async/await
it('should emit event', async () => {
  const promise = new Promise((resolve) => {
    service.on('event', resolve);
  });

  service.trigger();

  await promise;
  expect(true).toBe(true);
});
```

### Bug 3: Flaky Tests Due to Timing

```typescript
// Problem: Flaky test depending on timing
it('should process after delay', async () => {
  service.delayedProcess();

  await new Promise((resolve) => setTimeout(resolve, 100)); // Race condition!

  expect(service.isProcessed()).toBe(true); // Sometimes fails
});

// Solution: Use fake timers
it('should process after delay', () => {
  jest.useFakeTimers();

  service.delayedProcess();

  jest.advanceTimersByTime(1000); // Controlled timing

  expect(service.isProcessed()).toBe(true);

  jest.useRealTimers();
});
```

---

## Advanced Patterns

### Pattern 1: Testing with Multiple Mock Scenarios

```typescript
describe('AdvancedService', () => {
  describe.each([
    {
      scenario: 'with valid license',
      licenseStatus: 'ACTIVE',
      expectedResult: true,
    },
    {
      scenario: 'with expired license',
      licenseStatus: 'EXPIRED',
      expectedResult: false,
    },
    {
      scenario: 'with revoked license',
      licenseStatus: 'REVOKED',
      expectedResult: false,
    },
  ])('$scenario', ({ licenseStatus, expectedResult }) => {
    it(`should return ${expectedResult}`, async () => {
      mockLicenseService.getStatus.mockResolvedValue(licenseStatus);

      const result = await service.canPerformAction();

      expect(result).toBe(expectedResult);
    });
  });
});
```

### Pattern 2: Testing Retry Logic

```typescript
it('should retry on failure and succeed on third attempt', async () => {
  mockApiService.fetch
    .mockRejectedValueOnce(new Error('Network error'))
    .mockRejectedValueOnce(new Error('Timeout'))
    .mockResolvedValueOnce({ data: 'success' });

  const result = await service.fetchWithRetry('/api/data');

  expect(result.data).toBe('success');
  expect(mockApiService.fetch).toHaveBeenCalledTimes(3);
});
```

### Pattern 3: Testing Race Conditions

```typescript
it('should handle concurrent requests correctly', async () => {
  const promise1 = service.processJob('job-1');
  const promise2 = service.processJob('job-2');
  const promise3 = service.processJob('job-3');

  const results = await Promise.all([promise1, promise2, promise3]);

  expect(results).toHaveLength(3);
  expect(results.every((r) => r.status === 'completed')).toBe(true);
});
```

### Pattern 4: Testing Memory Leaks

```typescript
describe('Memory Leak Tests', () => {
  it('should cleanup listeners on destroy', () => {
    const service = new EventService();
    const listener = jest.fn();

    service.on('event', listener);

    expect(service.listenerCount('event')).toBe(1);

    service.destroy();

    expect(service.listenerCount('event')).toBe(0);
  });
});
```

---

## Summary

These examples demonstrate:

1. **Complete test coverage** for services, controllers, and complex logic
2. **Proper mocking patterns** for Prisma, EventEmitter, child processes, file system
3. **Real-world scenarios** from the BitBonsai codebase
4. **Before/after refactoring** examples showing common improvements
5. **Bug fixes** for typical testing issues
6. **Advanced patterns** for complex testing scenarios

For theoretical guidelines and best practices, refer to [TESTING_GUIDELINES.md](./TESTING_GUIDELINES.md).

---

**Maintained by**: BitBonsai Development Team
**Last Updated**: October 1, 2025
