import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { StripeService } from '../stripe.service';

describe('StripeService', () => {
  let service: StripeService;
  let prismaMock: any;

  beforeEach(async () => {
    process.env.STRIPE_SECRET_KEY = undefined;

    prismaMock = {
      license: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StripeService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<StripeService>(StripeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isConfigured', () => {
    it('should return false when STRIPE_SECRET_KEY is not set', () => {
      expect(service.isConfigured()).toBe(false);
    });

    it('should return true when STRIPE_SECRET_KEY is set', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';

      const module: TestingModule = await Test.createTestingModule({
        providers: [StripeService, { provide: PrismaService, useValue: prismaMock }],
      }).compile();

      const newService = module.get<StripeService>(StripeService);
      expect(newService.isConfigured()).toBe(true);
    });
  });
});
