#!/usr/bin/env ts-node
/**
 * Test Generator for NestJS Services
 *
 * Automatically generates comprehensive integration and e2e tests
 * for NestJS services following the project's code conventions.
 *
 * Usage:
 *   npx ts-node tools/generators/generate-tests.ts <service-name>
 *
 * Example:
 *   npx ts-node tools/generators/generate-tests.ts libraries
 */

import * as fs from 'fs';
import * as path from 'path';

interface ServiceConfig {
  name: string; // e.g., "libraries"
  className: string; // e.g., "LibrariesService"
  entityName: string; // e.g., "Library"
  hasNodeFK: boolean; // Foreign key to Node
  hasLibraryFK: boolean; // Foreign key to Library
  uniqueConstraints: string[]; // e.g., ["nodeId_path"]
  methods: string[]; // e.g., ["create", "findAll", "findOne", "update", "remove"]
}

function analyzeService(serviceName: string): ServiceConfig {
  const baseDir = path.join(process.cwd(), 'apps', 'backend', 'src', serviceName);
  const serviceFile = path.join(baseDir, `${serviceName}.service.ts`);

  if (!fs.existsSync(serviceFile)) {
    throw new Error(`Service file not found: ${serviceFile}`);
  }

  const serviceContent = fs.readFileSync(serviceFile, 'utf-8');

  // Extract class name
  const classMatch = serviceContent.match(/export class (\w+Service)/);
  const className = classMatch ? classMatch[1] : `${capitalize(serviceName)}Service`;

  // Extract entity name (singular)
  const entityName = serviceName.endsWith('ies')
    ? `${serviceName.slice(0, -3)}y` // libraries -> Library
    : serviceName.slice(0, -1); // nodes -> Node
  const entityClassName = capitalize(entityName);

  // Detect foreign keys
  const hasNodeFK = serviceContent.includes('nodeId');
  const hasLibraryFK = serviceContent.includes('libraryId') && !serviceName.includes('librar');

  // Detect unique constraints
  const uniqueConstraints: string[] = [];
  if (serviceContent.includes('nodeId_path')) {
    uniqueConstraints.push('nodeId_path');
  }

  // Detect methods
  const methods: string[] = [];
  if (serviceContent.includes('async create(')) methods.push('create');
  if (serviceContent.includes('async findAll(')) methods.push('findAll');
  if (serviceContent.includes('async findOne(')) methods.push('findOne');
  if (serviceContent.includes('async update(')) methods.push('update');
  if (serviceContent.includes('async remove(')) methods.push('remove');

  return {
    name: serviceName,
    className,
    entityName: entityClassName,
    hasNodeFK,
    hasLibraryFK,
    uniqueConstraints,
    methods,
  };
}

function generateIntegrationTests(config: ServiceConfig): string {
  const { name, className, entityName, hasNodeFK, hasLibraryFK, methods } = config;

  return `import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { ${entityName}, License, Node${hasLibraryFK ? ', Library' : ''} } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ${className} } from './${name}.service';

/**
 * Integration tests for ${className}
 *
 * Auto-generated comprehensive tests covering:
 * - Database constraints (foreign keys, unique constraints)
 * - CRUD operations with real database
 * - Data persistence and retrieval
 */
describe('${className} Integration Tests', () => {
  let module: TestingModule;
  let service: ${className};
  let prisma: PrismaService;
  let testLicense: License;
  ${hasNodeFK ? 'let testNode: Node;' : ''}
  ${hasLibraryFK ? 'let testLibrary: Library;' : ''}

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [${className}, PrismaService],
    }).compile();

    service = module.get<${className}>(${className});
    prisma = module.get<PrismaService>(PrismaService);

    // Create test fixtures
    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-${name.toUpperCase()}',
        tier: 'FREE',
        status: 'ACTIVE',
        email: '${name}@test.com',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
      },
    });
${
  hasNodeFK
    ? `
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
    });`
    : ''
}
${
  hasLibraryFK
    ? `
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
    });`
    : ''
}
  });

  afterAll(async () => {
    await prisma.${entityName.toLowerCase()}.deleteMany({});
    ${hasLibraryFK ? 'await prisma.library.deleteMany({});' : ''}
    ${hasNodeFK ? 'await prisma.node.deleteMany({});' : ''}
    await prisma.license.deleteMany({});
    await prisma.$disconnect();
    await module.close();
  });

  afterEach(async () => {
    await prisma.${entityName.toLowerCase()}.deleteMany({});
  });

${methods.includes('create') ? generateCreateTests(config) : ''}
${methods.includes('findAll') ? generateFindAllTests(config) : ''}
${methods.includes('findOne') ? generateFindOneTests(config) : ''}
${methods.includes('update') ? generateUpdateTests(config) : ''}
${methods.includes('remove') ? generateRemoveTests(config) : ''}
});
`;
}

function generateCreateTests(config: ServiceConfig): string {
  const { hasNodeFK, hasLibraryFK } = config;

  return `
  describe('create', () => {
    it('should create ${entityName.toLowerCase()} with valid data', async () => {
      const createDto = {
        name: 'Test ${entityName}',
        ${hasNodeFK ? 'nodeId: testNode.id,' : ''}
        ${hasLibraryFK ? 'libraryId: testLibrary.id,' : ''}
      };

      const result = await service.create(createDto);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe(createDto.name);
    });

    ${
      hasNodeFK
        ? `
    it('should throw NotFoundException for non-existent nodeId', async () => {
      await expect(service.create({
        name: 'Test',
        nodeId: 'non-existent-id',
      })).rejects.toThrow(NotFoundException);
    });`
        : ''
    }

    ${
      hasLibraryFK
        ? `
    it('should throw error for non-existent libraryId', async () => {
      await expect(service.create({
        name: 'Test',
        libraryId: 'non-existent-id',
      })).rejects.toThrow();
    });`
        : ''
    }

    it('should persist to database', async () => {
      const created = await service.create({
        name: 'Persistent Test',
        ${hasNodeFK ? 'nodeId: testNode.id,' : ''}
        ${hasLibraryFK ? 'libraryId: testLibrary.id,' : ''}
      });

      const retrieved = await prisma.${entityName.toLowerCase()}.findUnique({
        where: { id: created.id },
      });

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Persistent Test');
    });

    it('should set timestamps correctly', async () => {
      const before = new Date();
      const result = await service.create({
        name: 'Timestamp Test',
        ${hasNodeFK ? 'nodeId: testNode.id,' : ''}
        ${hasLibraryFK ? 'libraryId: testLibrary.id,' : ''}
      });
      const after = new Date();

      expect(result.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });`;
}

function generateFindAllTests(config: ServiceConfig): string {
  const { hasNodeFK, hasLibraryFK } = config;

  return `
  describe('findAll', () => {
    it('should return empty array when no records exist', async () => {
      const result = await service.findAll();
      expect(result).toEqual([]);
    });

    it('should return all records', async () => {
      await service.create({
        name: 'First',
        ${hasNodeFK ? 'nodeId: testNode.id,' : ''}
        ${hasLibraryFK ? 'libraryId: testLibrary.id,' : ''}
      });
      await service.create({
        name: 'Second',
        ${hasNodeFK ? 'nodeId: testNode.id,' : ''}
        ${hasLibraryFK ? 'libraryId: testLibrary.id,' : ''}
      });

      const result = await service.findAll();
      expect(result).toHaveLength(2);
    });
  });`;
}

function generateFindOneTests(config: ServiceConfig): string {
  const { hasNodeFK, hasLibraryFK } = config;

  return `
  describe('findOne', () => {
    it('should retrieve record by id', async () => {
      const created = await service.create({
        name: 'Test Record',
        ${hasNodeFK ? 'nodeId: testNode.id,' : ''}
        ${hasLibraryFK ? 'libraryId: testLibrary.id,' : ''}
      });

      const result = await service.findOne(created.id);
      expect(result).toBeDefined();
      expect(result.id).toBe(created.id);
    });

    it('should throw NotFoundException for non-existent id', async () => {
      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });`;
}

function generateUpdateTests(config: ServiceConfig): string {
  const { hasNodeFK, hasLibraryFK } = config;

  return `
  describe('update', () => {
    it('should update existing record', async () => {
      const created = await service.create({
        name: 'Original',
        ${hasNodeFK ? 'nodeId: testNode.id,' : ''}
        ${hasLibraryFK ? 'libraryId: testLibrary.id,' : ''}
      });

      const updated = await service.update(created.id, { name: 'Updated' });
      expect(updated.name).toBe('Updated');
    });

    it('should throw NotFoundException for non-existent id', async () => {
      await expect(service.update('non-existent-id', { name: 'Test' }))
        .rejects.toThrow(NotFoundException);
    });

    it('should update updatedAt timestamp', async () => {
      const created = await service.create({
        name: 'Test',
        ${hasNodeFK ? 'nodeId: testNode.id,' : ''}
        ${hasLibraryFK ? 'libraryId: testLibrary.id,' : ''}
      });

      await new Promise(resolve => setTimeout(resolve, 10));
      const updated = await service.update(created.id, { name: 'Updated' });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    });
  });`;
}

function generateRemoveTests(config: ServiceConfig): string {
  const { entityName, hasNodeFK, hasLibraryFK } = config;

  return `
  describe('remove', () => {
    it('should delete existing record', async () => {
      const created = await service.create({
        name: 'To Delete',
        ${hasNodeFK ? 'nodeId: testNode.id,' : ''}
        ${hasLibraryFK ? 'libraryId: testLibrary.id,' : ''}
      });

      await service.remove(created.id);

      const retrieved = await prisma.${entityName.toLowerCase()}.findUnique({
        where: { id: created.id },
      });
      expect(retrieved).toBeNull();
    });

    it('should throw NotFoundException for non-existent id', async () => {
      await expect(service.remove('non-existent-id'))
        .rejects.toThrow(NotFoundException);
    });
  });`;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function writeTestFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`✅ Generated: ${filePath}`);
}

// Main execution
const serviceName = process.argv[2];

if (!serviceName) {
  console.error('Usage: npx ts-node tools/generators/generate-tests.ts <service-name>');
  console.error('Example: npx ts-node tools/generators/generate-tests.ts libraries');
  process.exit(1);
}

try {
  console.log(`\n🔍 Analyzing service: ${serviceName}...`);
  const config = analyzeService(serviceName);

  console.log(`📊 Service Analysis:`);
  console.log(`   - Class: ${config.className}`);
  console.log(`   - Entity: ${config.entityName}`);
  console.log(
    `   - Foreign Keys: ${config.hasNodeFK ? 'Node' : ''} ${config.hasLibraryFK ? 'Library' : ''}`
  );
  console.log(`   - Methods: ${config.methods.join(', ')}`);

  console.log(`\n⚙️  Generating integration tests...`);
  const integrationTests = generateIntegrationTests(config);

  const outputPath = path.join(
    process.cwd(),
    'apps',
    'backend',
    'src',
    serviceName,
    `${serviceName}.service.integration.spec.ts`
  );

  writeTestFile(outputPath, integrationTests);

  console.log(`\n✅ Test generation complete!`);
  console.log(`\nNext steps:`);
  console.log(`  1. Review generated tests: ${outputPath}`);
  console.log(
    `  2. Run tests: npx nx test backend --testFile=${serviceName}.service.integration.spec.ts`
  );
  console.log(`  3. Adjust test data if needed\n`);
} catch (error) {
  console.error(`\n❌ Error:`, error instanceof Error ? error.message : error);
  process.exit(1);
}
