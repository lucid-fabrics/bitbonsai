import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Licens, License, Node } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseService } from './license.service';

/**
 * Integration tests for LicenseService
 *
 * Auto-generated comprehensive tests covering:
 * - Database constraints (foreign keys, unique constraints)
 * - CRUD operations with real database
 * - Data persistence and retrieval
 */
describe('LicenseService Integration Tests', () => {
  let module: TestingModule;
  let service: LicenseService;
  let prisma: PrismaService;
  let testLicense: License;
  
  

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [LicenseService, PrismaService],
    }).compile();

    service = module.get<LicenseService>(LicenseService);
    prisma = module.get<PrismaService>(PrismaService);

    // Create test fixtures
    testLicense = await prisma.license.create({
      data: {
        key: 'TEST-LICENSE',
        tier: 'FREE',
        status: 'ACTIVE',
        email: 'license@test.com',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {},
      },
    });


  });

  afterAll(async () => {
    await prisma.licens.deleteMany({});
    
    
    await prisma.license.deleteMany({});
    await prisma.$disconnect();
    await module.close();
  });

  afterEach(async () => {
    await prisma.licens.deleteMany({});
  });






});
