import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../testing/mock-providers';
import { DatabaseInitService } from '../../database-init.service';

describe('DatabaseInitService', () => {
  let service: DatabaseInitService;
  let prisma: any;

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
    it('should handle database errors gracefully', async () => {
      prisma.settings.findFirst.mockRejectedValue(new Error('Connection refused'));

      // Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('ensureMainNodeExists (via onModuleInit)', () => {
    it('should not create node when setup is not complete', async () => {
      prisma.settings.findFirst.mockResolvedValue({ isSetupComplete: false });
      prisma.node.count.mockResolvedValue(0);

      await service.onModuleInit();

      expect(prisma.node.create).not.toHaveBeenCalled();
    });

    it('should not create node when node already exists', async () => {
      prisma.settings.findFirst.mockResolvedValue({ isSetupComplete: true });
      prisma.node.count.mockResolvedValue(1);

      await service.onModuleInit();

      expect(prisma.node.create).not.toHaveBeenCalled();
    });

    it('should create MAIN node when setup is complete but no node exists', async () => {
      prisma.settings.findFirst.mockResolvedValue({ isSetupComplete: true });
      prisma.node.count.mockResolvedValue(0);
      prisma.node.create.mockResolvedValue({ id: 'node-1', role: 'MAIN' });

      await service.onModuleInit();

      expect(prisma.node.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'MAIN',
            status: 'ONLINE',
            acceleration: 'CPU',
          }),
        })
      );
    });
  });
});
