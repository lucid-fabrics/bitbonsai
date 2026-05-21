import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    // Clean up database connection after each test
    await service.$disconnect();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have Prisma client methods available', () => {
    expect(typeof service.$connect).toBe('function');
    expect(typeof service.$disconnect).toBe('function');
  });

  describe('onModuleInit', () => {
    it('should connect to database and log success', async () => {
      const connectSpy = jest.spyOn(service, '$connect').mockResolvedValue();
      const loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await service.onModuleInit();

      expect(connectSpy).toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith('Database connection established');

      loggerSpy.mockRestore();
    });

    it('should handle connection errors', async () => {
      const error = new Error('Connection failed');
      const connectSpy = jest.spyOn(service, '$connect').mockRejectedValue(error);
      const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await expect(service.onModuleInit()).rejects.toThrow('Connection failed');

      expect(connectSpy).toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to connect to database', error);

      loggerErrorSpy.mockRestore();
    });
  });

  describe('onModuleDestroy', () => {
    it('should disconnect from database and log success', async () => {
      const disconnectSpy = jest.spyOn(service, '$disconnect').mockResolvedValue();
      const loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await service.onModuleDestroy();

      expect(disconnectSpy).toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith('Database connection closed');

      loggerSpy.mockRestore();
    });
  });

  describe('database operations', () => {
    it('should have Prisma client methods available', () => {
      // Verify that PrismaClient methods are accessible
      expect(typeof service.$queryRaw).toBe('function');
      expect(typeof service.$executeRaw).toBe('function');
      expect(typeof service.$transaction).toBe('function');
    });
  });
});
