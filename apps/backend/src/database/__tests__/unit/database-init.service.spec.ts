import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../testing/mock-providers';
import { DatabaseInitService } from '../../database-init.service';

describe('DatabaseInitService', () => {
  let service: DatabaseInitService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [DatabaseInitService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<DatabaseInitService>(DatabaseInitService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should skip license creation when licenses exist', async () => {
      prisma.license.count.mockResolvedValue(1);
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.node.count.mockResolvedValue(0);

      await service.onModuleInit();

      expect(prisma.license.count).toHaveBeenCalled();
      expect(prisma.license.create).not.toHaveBeenCalled();
    });

    it('should create default license when none exist', async () => {
      prisma.license.count.mockResolvedValue(0);
      prisma.license.create.mockResolvedValue({
        id: '1',
        key: 'FREE-TEST123',
        tier: 'FREE',
        status: 'ACTIVE',
      });
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.node.count.mockResolvedValue(0);

      await service.onModuleInit();

      expect(prisma.license.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tier: 'FREE',
            status: 'ACTIVE',
            email: 'admin@localhost',
            maxNodes: 10,
            maxConcurrentJobs: 10,
          }),
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      prisma.license.count.mockRejectedValue(new Error('Connection refused'));

      // Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('ensureMainNodeExists (via onModuleInit)', () => {
    it('should not create node when setup is not complete', async () => {
      prisma.license.count.mockResolvedValue(1);
      prisma.settings.findFirst.mockResolvedValue({ isSetupComplete: false });
      prisma.node.count.mockResolvedValue(0);

      await service.onModuleInit();

      expect(prisma.node.create).not.toHaveBeenCalled();
    });

    it('should not create node when node already exists', async () => {
      prisma.license.count.mockResolvedValue(1);
      prisma.settings.findFirst.mockResolvedValue({ isSetupComplete: true });
      prisma.node.count.mockResolvedValue(1);

      await service.onModuleInit();

      expect(prisma.node.create).not.toHaveBeenCalled();
    });

    it('should create MAIN node when setup is complete but no node exists', async () => {
      prisma.license.count.mockResolvedValue(1);
      prisma.settings.findFirst.mockResolvedValue({ isSetupComplete: true });
      prisma.node.count.mockResolvedValue(0);
      prisma.license.findFirst.mockResolvedValue({ id: 'license-1' });
      prisma.node.create.mockResolvedValue({ id: 'node-1', role: 'MAIN' });

      await service.onModuleInit();

      expect(prisma.node.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'MAIN',
            status: 'ONLINE',
            acceleration: 'CPU',
            licenseId: 'license-1',
          }),
        })
      );
    });

    it('should not create node when no license is found', async () => {
      prisma.license.count.mockResolvedValue(1);
      prisma.settings.findFirst.mockResolvedValue({ isSetupComplete: true });
      prisma.node.count.mockResolvedValue(0);
      prisma.license.findFirst.mockResolvedValue(null);

      await service.onModuleInit();

      expect(prisma.node.create).not.toHaveBeenCalled();
    });
  });
});
