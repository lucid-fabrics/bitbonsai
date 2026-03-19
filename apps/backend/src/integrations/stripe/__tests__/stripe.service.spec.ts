import { Test, TestingModule } from '@nestjs/testing';
import { LicenseRepository } from '../../../common/repositories/license.repository';
import { StripeService } from '../stripe.service';

describe('StripeService', () => {
  let service: StripeService;
  let licenseRepositoryMock: any;

  beforeEach(async () => {
    process.env.STRIPE_SECRET_KEY = '';

    licenseRepositoryMock = {
      findByEmail: jest.fn(),
      findFirstWhere: jest.fn(),
      updateByKey: jest.fn(),
      updateById: jest.fn(),
      upsertByEmail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StripeService, { provide: LicenseRepository, useValue: licenseRepositoryMock }],
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
        providers: [StripeService, { provide: LicenseRepository, useValue: licenseRepositoryMock }],
      }).compile();

      const newService = module.get<StripeService>(StripeService);
      expect(newService.isConfigured()).toBe(true);
    });
  });
});
