import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job, Library, Node, Policy } from '@prisma/client';
import { DataAccessService } from '../../../core/services/data-access.service';
import { FileRelocatorService } from '../../../core/services/file-relocator.service';
import { LibrariesService } from '../../../libraries/libraries.service';
import { NodesService } from '../../../nodes/nodes.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../../queue/queue.service';
import { EncodingProcessorService } from '../../encoding-processor.service';
import { FfmpegService } from '../../ffmpeg.service';

/**
 * Test Helpers for Integration Tests
 *
 * Provides utilities for setting up test environment:
 * - In-memory SQLite database
 * - Test module creation
 * - Database seeding
 * - Job creation helpers
 */

/**
 * Create in-memory test database connection string
 */
export function getInMemoryDatabaseUrl(): string {
  // Use in-memory SQLite for fast tests
  return 'file::memory:?cache=shared';
}

/**
 * Create test module with all dependencies
 */
export async function createTestModule(): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      EncodingProcessorService,
      PrismaService,
      QueueService,
      FfmpegService,
      LibrariesService,
      NodesService,
      DataAccessService,
      FileRelocatorService,
      {
        provide: EventEmitter2,
        useValue: {
          emit: jest.fn(),
          on: jest.fn(),
          once: jest.fn(),
          removeListener: jest.fn(),
          removeAllListeners: jest.fn(),
        },
      },
    ],
  }).compile();

  return moduleRef;
}

/**
 * Seed test database with node, library, and policy
 */
export async function seedTestDatabase(
  prisma: PrismaService
): Promise<{ node: Node; library: Library; policy: Policy }> {
  // Create test license
  const license = await prisma.license.create({
    data: {
      key: 'test-license-key',
      tier: 'FREE',
      status: 'ACTIVE',
      email: 'test@example.com',
      maxNodes: 1,
      maxConcurrentJobs: 4,
      features: { multiNode: false },
    },
  });

  // Create test node
  const node = await prisma.node.create({
    data: {
      name: 'Test Node',
      role: 'MAIN',
      status: 'ONLINE',
      version: '1.0.0',
      acceleration: 'CPU',
      apiKey: 'test-api-key',
      lastHeartbeat: new Date(),
      maxWorkers: 4,
      licenseId: license.id,
    },
  });

  // Create test library
  const library = await prisma.library.create({
    data: {
      name: 'Test Library',
      path: '/tmp/test-library',
      mediaType: 'MIXED',
      nodeId: node.id,
    },
  });

  // Create test policy
  const policy = await prisma.policy.create({
    data: {
      name: 'Test Policy - HEVC Quality',
      preset: 'QUALITY_AV1',
      targetCodec: 'HEVC',
      targetQuality: 20,
      deviceProfiles: {},
      advancedSettings: {},
      atomicReplace: true,
      verifyOutput: false,
      libraryId: library.id,
    },
  });

  return { node, library, policy };
}

/**
 * Create test job in database
 */
export async function createTestJob(
  prisma: PrismaService,
  options: {
    filePath: string;
    fileLabel: string;
    nodeId: string;
    libraryId: string;
    policyId: string;
    sourceCodec?: string;
    targetCodec?: string;
    beforeSizeBytes?: bigint;
    stage?: string;
  }
): Promise<Job> {
  return prisma.job.create({
    data: {
      filePath: options.filePath,
      fileLabel: options.fileLabel,
      sourceCodec: options.sourceCodec || 'H.264',
      targetCodec: options.targetCodec || 'HEVC',
      beforeSizeBytes: options.beforeSizeBytes || BigInt(100000000),
      stage: (options.stage as any) || 'QUEUED',
      nodeId: options.nodeId,
      libraryId: options.libraryId,
      policyId: options.policyId,
    },
  });
}

/**
 * Wait for job to reach a specific stage
 */
export async function waitForJobStage(
  prisma: PrismaService,
  jobId: string,
  stage: string,
  timeoutMs = 60000
): Promise<Job | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });

    if (job && job.stage === stage) {
      return job;
    }

    // Poll every 500ms
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

/**
 * Wait for job to complete (COMPLETED or FAILED)
 */
export async function waitForJobCompletion(
  prisma: PrismaService,
  jobId: string,
  timeoutMs = 120000
): Promise<Job | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });

    if (job && (job.stage === 'COMPLETED' || job.stage === 'FAILED')) {
      return job;
    }

    // Poll every 1 second
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return null;
}

/**
 * Get all jobs for a library
 */
export async function getLibraryJobs(prisma: PrismaService, libraryId: string): Promise<Job[]> {
  return prisma.job.findMany({
    where: { libraryId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Clean up test jobs
 */
export async function cleanupTestJobs(prisma: PrismaService, libraryId: string): Promise<void> {
  await prisma.job.deleteMany({
    where: { libraryId },
  });
}

/**
 * Reset database for test isolation
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  // Delete in correct order due to foreign key constraints
  await prisma.job.deleteMany({});
  await prisma.policy.deleteMany({});
  await prisma.library.deleteMany({});
  await prisma.metric.deleteMany({});
  await prisma.node.deleteMany({});
  await prisma.license.deleteMany({});
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
