import { PrismaService } from '../../prisma/prisma.service';
import { HealthController } from '../health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: Partial<PrismaService>;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
    };
    controller = new HealthController(prisma as PrismaService);
  });

  describe('check', () => {
    it('should return ok status when database is connected', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([1]);

      const result = await controller.check();

      expect(result.status).toBe('ok');
      expect(result.database).toBe('connected');
      expect(result.timestamp).toBeDefined();
    });

    it('should return error status when database is disconnected', async () => {
      (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      const result = await controller.check();

      expect(result.status).toBe('error');
      expect(result.database).toBe('disconnected');
    });
  });
});
