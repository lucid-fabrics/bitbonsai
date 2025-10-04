import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Test Database Helper
 *
 * Provides utilities for setting up and tearing down test databases.
 * Uses in-memory SQLite for fast, isolated tests.
 */
export class TestDatabaseHelper {
  private static prismaClient: PrismaClient;
  private static testDbPath: string;

  /**
   * Setup a fresh test database
   * - Creates a new in-memory or file-based SQLite database
   * - Runs migrations
   * - Returns a connected Prisma client
   */
  static async setupTestDatabase(): Promise<PrismaClient> {
    // Use in-memory SQLite for speed
    const dbUrl = 'file::memory:?cache=shared';

    process.env.DATABASE_URL = dbUrl;

    TestDatabaseHelper.prismaClient = new PrismaClient({
      datasources: {
        db: {
          url: dbUrl,
        },
      },
    });

    await TestDatabaseHelper.prismaClient.$connect();

    // Run migrations
    try {
      execSync('npx prisma migrate deploy', {
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: 'pipe',
      });
    } catch (error) {
      // Migrations might fail on in-memory DB, try push instead
      execSync('npx prisma db push --skip-generate', {
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: 'pipe',
      });
    }

    return TestDatabaseHelper.prismaClient;
  }

  /**
   * Setup a file-based test database (for tests that need persistence)
   */
  static async setupFileTestDatabase(dbName: string = 'test.db'): Promise<PrismaClient> {
    const testDbDir = path.join(process.cwd(), 'test-data');
    if (!fs.existsSync(testDbDir)) {
      fs.mkdirSync(testDbDir, { recursive: true });
    }

    TestDatabaseHelper.testDbPath = path.join(testDbDir, dbName);

    // Remove existing test DB
    if (fs.existsSync(TestDatabaseHelper.testDbPath)) {
      fs.unlinkSync(TestDatabaseHelper.testDbPath);
    }

    const dbUrl = `file:${TestDatabaseHelper.testDbPath}`;
    process.env.DATABASE_URL = dbUrl;

    TestDatabaseHelper.prismaClient = new PrismaClient({
      datasources: {
        db: {
          url: dbUrl,
        },
      },
    });

    await TestDatabaseHelper.prismaClient.$connect();

    // Run migrations
    execSync('npx prisma db push --skip-generate', {
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'pipe',
    });

    return TestDatabaseHelper.prismaClient;
  }

  /**
   * Clean all data from test database
   */
  static async cleanDatabase(prisma: PrismaClient): Promise<void> {
    // Delete in order to respect foreign key constraints
    await prisma.metric.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.policy.deleteMany({});
    await prisma.library.deleteMany({});
    await prisma.node.deleteMany({});
    await prisma.license.deleteMany({});
  }

  /**
   * Teardown test database
   */
  static async teardownTestDatabase(): Promise<void> {
    if (TestDatabaseHelper.prismaClient) {
      await TestDatabaseHelper.prismaClient.$disconnect();
    }

    if (TestDatabaseHelper.testDbPath && fs.existsSync(TestDatabaseHelper.testDbPath)) {
      fs.unlinkSync(TestDatabaseHelper.testDbPath);
    }
  }

  /**
   * Create test data fixtures
   */
  static async createTestFixtures(prisma: PrismaClient) {
    const license = await prisma.license.create({
      data: {
        key: 'TEST-LICENSE-KEY',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'test@example.com',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        features: {},
      },
    });

    const node = await prisma.node.create({
      data: {
        name: 'Test Node',
        role: 'MAIN',
        status: 'ONLINE',
        version: '1.0.0',
        acceleration: 'CPU',
        apiKey: 'test-api-key',
        lastHeartbeat: new Date(),
        licenseId: license.id,
      },
    });

    const library = await prisma.library.create({
      data: {
        name: 'Test Library',
        path: '/test/path',
        mediaType: 'MIXED',
        enabled: true,
        totalFiles: 0,
        totalSizeBytes: BigInt(0),
        nodeId: node.id,
      },
    });

    return { license, node, library };
  }
}
