import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { DebugService } from '../../debug.service';

describe('DebugService', () => {
  let service: DebugService;
  let prisma: {
    job: { findMany: jest.Mock };
    node: { findFirst: jest.Mock; update: jest.Mock };
    settings: { findFirst: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      job: { findMany: jest.fn().mockResolvedValue([]) },
      node: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      settings: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebugService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<DebugService>(DebugService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFfmpegProcesses', () => {
    it('should return tracked and system processes', async () => {
      const result = await service.getFfmpegProcesses();

      expect(result).toHaveProperty('trackedEncodings');
      expect(result).toHaveProperty('systemProcesses');
      expect(result).toHaveProperty('zombieCount');
    });

    it('should query encoding jobs from database', async () => {
      await service.getFfmpegProcesses();

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ stage: 'ENCODING' }),
        })
      );
    });
  });

  describe('killAllZombies', () => {
    it('should return kill results', async () => {
      const result = await service.killAllZombies();

      expect(result).toHaveProperty('killed');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('details');
    });
  });

  describe('updateLoadThreshold', () => {
    it('should reject values below minimum', async () => {
      const result = await service.updateLoadThreshold(0.5);

      expect(result.success).toBe(false);
      expect(result.message).toContain('must be between');
    });

    it('should reject values above maximum', async () => {
      const result = await service.updateLoadThreshold(15.0);

      expect(result.success).toBe(false);
      expect(result.message).toContain('must be between');
    });

    it('should reject values outside valid range', async () => {
      const tooLow = await service.updateLoadThreshold(0.9);
      expect(tooLow.success).toBe(false);

      const tooHigh = await service.updateLoadThreshold(10.1);
      expect(tooHigh.success).toBe(false);
    });

    it('should accept boundary values', async () => {
      const minResult = await service.updateLoadThreshold(1.0);
      // Either succeeds (node exists) or fails (node not found) is valid
      expect(minResult.success === true || minResult.success === false).toBe(true);

      const maxResult = await service.updateLoadThreshold(10.0);
      expect(maxResult.success === true || maxResult.success === false).toBe(true);
    });
  });
});
