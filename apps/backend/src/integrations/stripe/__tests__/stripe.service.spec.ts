import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LicenseStatus, LicenseTier } from '@prisma/client';
import Stripe from 'stripe';
import { LicenseRepository } from '../../../common/repositories/license.repository';
import { StripeService } from '../stripe.service';

// Helper to build a configured service with a mocked Stripe instance
async function buildConfiguredService(
  licenseRepositoryMock: Record<string, jest.Mock>,
  stripeMock: Record<string, unknown>
): Promise<StripeService> {
  process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
  const module: TestingModule = await Test.createTestingModule({
    providers: [StripeService, { provide: LicenseRepository, useValue: licenseRepositoryMock }],
  }).compile();
  const svc = module.get<StripeService>(StripeService);
  // Inject mock stripe instance directly
  (svc as unknown as { stripe: unknown }).stripe = stripeMock;
  return svc;
}

describe('StripeService', () => {
  let service: StripeService;
  let licenseRepositoryMock: Record<string, jest.Mock>;

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

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = '';
    process.env.STRIPE_WEBHOOK_SECRET = '';
    process.env.STRIPE_PRICE_STARTER = '';
    process.env.STRIPE_PRICE_PRO = '';
    process.env.STRIPE_PRICE_ENTERPRISE = '';
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

  describe('createCheckoutSession', () => {
    it('should throw when stripe is not configured', async () => {
      await expect(
        service.createCheckoutSession({
          email: 'a@b.com',
          priceId: 'price_1',
          successUrl: 'http://ok',
          cancelUrl: 'http://cancel',
        })
      ).rejects.toThrow('Stripe is not configured');
    });

    it('should create a checkout session and return sessionId + url', async () => {
      const mockSession = { id: 'sess_123', url: 'https://checkout.stripe.com/sess_123' };
      const stripeMock = {
        checkout: { sessions: { create: jest.fn().mockResolvedValue(mockSession) } },
      };
      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);

      const result = await svc.createCheckoutSession({
        email: 'test@example.com',
        priceId: 'price_pro',
        successUrl: 'https://app/success',
        cancelUrl: 'https://app/cancel',
      });

      expect(result).toEqual({ sessionId: 'sess_123', url: mockSession.url });
      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          customer_email: 'test@example.com',
          line_items: [{ price: 'price_pro', quantity: 1 }],
        })
      );
    });
  });

  describe('getCustomerPortalUrl', () => {
    it('should throw when stripe is not configured', async () => {
      await expect(service.getCustomerPortalUrl('cus_123', 'https://app')).rejects.toThrow(
        'Stripe is not configured'
      );
    });

    it('should return billing portal session url', async () => {
      const stripeMock = {
        billingPortal: {
          sessions: {
            create: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/p' }),
          },
        },
      };
      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);

      const url = await svc.getCustomerPortalUrl('cus_abc', 'https://app/return');
      expect(url).toBe('https://billing.stripe.com/p');
      expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_abc',
        return_url: 'https://app/return',
      });
    });
  });

  describe('getPlans', () => {
    it('should return empty array when stripe is not configured', async () => {
      const result = await service.getPlans();
      expect(result).toEqual([]);
    });

    it('should return plans for known price IDs', async () => {
      process.env.STRIPE_PRICE_STARTER = 'price_starter_test';
      process.env.STRIPE_PRICE_PRO = 'price_pro_test';
      process.env.STRIPE_PRICE_ENTERPRISE = 'price_enterprise_test';

      const mockProduct: Partial<Stripe.Product> = { name: 'Starter Plan' };
      const mockPrice: Partial<Stripe.Price> = {
        unit_amount: 4900,
        recurring: { interval: 'month' } as Stripe.Price.Recurring,
        product: mockProduct as Stripe.Product,
      };

      const pricesRetrieve = jest.fn().mockResolvedValue(mockPrice);
      const stripeMock = { prices: { retrieve: pricesRetrieve } };
      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);

      const plans = await svc.getPlans();
      expect(plans.length).toBeGreaterThan(0);
      expect(plans[0]).toMatchObject({
        name: 'Starter Plan',
        price: 49,
        interval: 'month',
      });
    });

    it('should skip prices that throw (not found in Stripe)', async () => {
      process.env.STRIPE_PRICE_STARTER = 'price_missing';
      process.env.STRIPE_PRICE_PRO = 'price_missing2';
      process.env.STRIPE_PRICE_ENTERPRISE = 'price_missing3';

      const pricesRetrieve = jest.fn().mockRejectedValue(new Error('No such price'));
      const stripeMock = { prices: { retrieve: pricesRetrieve } };
      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);

      const plans = await svc.getPlans();
      expect(plans).toEqual([]);
    });

    it('should handle price with no unit_amount (defaults to 0)', async () => {
      process.env.STRIPE_PRICE_STARTER = 'price_free';
      process.env.STRIPE_PRICE_PRO = 'price_free2';
      process.env.STRIPE_PRICE_ENTERPRISE = 'price_free3';

      const mockProduct: Partial<Stripe.Product> = { name: 'Free Plan' };
      const mockPrice = { unit_amount: null, recurring: null, product: mockProduct };
      const pricesRetrieve = jest.fn().mockResolvedValue(mockPrice);
      const stripeMock = { prices: { retrieve: pricesRetrieve } };
      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);

      const plans = await svc.getPlans();
      expect(plans[0].price).toBe(0);
      expect(plans[0].interval).toBe('month');
    });
  });

  describe('handleWebhook', () => {
    it('should throw when stripe is not configured', async () => {
      await expect(service.handleWebhook('sig', Buffer.from('body'))).rejects.toThrow(
        'Stripe is not configured'
      );
    });

    it('should throw when STRIPE_WEBHOOK_SECRET is not set', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = '';
      const stripeMock = { webhooks: { constructEvent: jest.fn() } };
      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);

      await expect(svc.handleWebhook('sig', Buffer.from('body'))).rejects.toThrow(
        'STRIPE_WEBHOOK_SECRET not configured'
      );
    });

    it('should throw UnauthorizedException when signature verification fails', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const constructEvent = jest.fn().mockImplementation(() => {
        throw new Error('Invalid signature');
      });
      const stripeMock = { webhooks: { constructEvent } };
      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);

      await expect(svc.handleWebhook('bad_sig', Buffer.from('body'))).rejects.toThrow(
        UnauthorizedException
      );
    });

    it('should handle checkout.session.completed with existing license', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      process.env.STRIPE_PRICE_STARTER = 'price_starter_mapped';

      const mockSubscription: Partial<Stripe.Subscription> = {
        id: 'sub_1',
        items: {
          data: [{ price: { id: 'price_starter_mapped' } } as Stripe.SubscriptionItem],
        } as Stripe.ApiList<Stripe.SubscriptionItem>,
      };

      const mockEvent = {
        type: 'checkout.session.completed',
        data: {
          object: {
            customer_email: 'user@example.com',
            customer: 'cus_abc',
            subscription: 'sub_1',
          },
        },
      } as unknown as Stripe.Event;

      const constructEvent = jest.fn().mockReturnValue(mockEvent);
      const subscriptionsRetrieve = jest.fn().mockResolvedValue(mockSubscription);
      const stripeMock = {
        webhooks: { constructEvent },
        subscriptions: { retrieve: subscriptionsRetrieve },
      };

      licenseRepositoryMock.findByEmail.mockResolvedValue([
        { id: 'lic_1', key: 'COM-existing123' },
      ]);
      licenseRepositoryMock.updateByKey.mockResolvedValue({});

      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);
      await svc.handleWebhook('sig', Buffer.from('body'));

      expect(licenseRepositoryMock.updateByKey).toHaveBeenCalledWith(
        'COM-existing123',
        expect.objectContaining({
          tier: LicenseTier.COMMERCIAL_STARTER,
          status: LicenseStatus.ACTIVE,
          maxNodes: 15,
        })
      );
    });

    it('should handle checkout.session.completed and create new license when none exists', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      process.env.STRIPE_PRICE_PRO = 'price_pro_mapped';

      const mockSubscription: Partial<Stripe.Subscription> = {
        id: 'sub_2',
        items: {
          data: [{ price: { id: 'price_pro_mapped' } } as Stripe.SubscriptionItem],
        } as Stripe.ApiList<Stripe.SubscriptionItem>,
      };

      const mockEvent = {
        type: 'checkout.session.completed',
        data: {
          object: {
            customer_email: null,
            metadata: { email: 'new@example.com' },
            customer: 'cus_new',
            subscription: 'sub_2',
          },
        },
      } as unknown as Stripe.Event;

      const constructEvent = jest.fn().mockReturnValue(mockEvent);
      const subscriptionsRetrieve = jest.fn().mockResolvedValue(mockSubscription);
      const stripeMock = {
        webhooks: { constructEvent },
        subscriptions: { retrieve: subscriptionsRetrieve },
      };

      licenseRepositoryMock.findByEmail.mockResolvedValue([]);
      licenseRepositoryMock.upsertByEmail.mockResolvedValue({});

      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);
      await svc.handleWebhook('sig', Buffer.from('body'));

      expect(licenseRepositoryMock.upsertByEmail).toHaveBeenCalledWith(
        'new@example.com',
        {},
        expect.objectContaining({
          tier: LicenseTier.COMMERCIAL_PRO,
          status: LicenseStatus.ACTIVE,
          maxNodes: 50,
        })
      );
    });

    it('should handle checkout.session.completed with no email gracefully', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

      const mockEvent = {
        type: 'checkout.session.completed',
        data: {
          object: {
            customer_email: null,
            metadata: {},
            customer: 'cus_x',
            subscription: 'sub_x',
          },
        },
      } as unknown as Stripe.Event;

      const constructEvent = jest.fn().mockReturnValue(mockEvent);
      const subscriptionsRetrieve = jest.fn();
      const stripeMock = {
        webhooks: { constructEvent },
        subscriptions: { retrieve: subscriptionsRetrieve },
      };

      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);
      await expect(svc.handleWebhook('sig', Buffer.from('body'))).resolves.not.toThrow();
      expect(subscriptionsRetrieve).not.toHaveBeenCalled();
    });

    it('should handle checkout.session.completed with unknown priceId gracefully', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

      const mockSubscription: Partial<Stripe.Subscription> = {
        id: 'sub_3',
        items: {
          data: [{ price: { id: 'price_unknown_xyz' } } as Stripe.SubscriptionItem],
        } as Stripe.ApiList<Stripe.SubscriptionItem>,
      };

      const mockEvent = {
        type: 'checkout.session.completed',
        data: {
          object: {
            customer_email: 'u@x.com',
            customer: 'cus_y',
            subscription: 'sub_3',
          },
        },
      } as unknown as Stripe.Event;

      const constructEvent = jest.fn().mockReturnValue(mockEvent);
      const subscriptionsRetrieve = jest.fn().mockResolvedValue(mockSubscription);
      const stripeMock = {
        webhooks: { constructEvent },
        subscriptions: { retrieve: subscriptionsRetrieve },
      };

      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);
      await expect(svc.handleWebhook('sig', Buffer.from('body'))).resolves.not.toThrow();
      expect(licenseRepositoryMock.findByEmail).not.toHaveBeenCalled();
    });

    it('should handle customer.subscription.updated with known license', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      process.env.STRIPE_PRICE_ENTERPRISE = 'price_ent_mapped';

      const mockSubscription: Partial<Stripe.Subscription> = {
        id: 'sub_ent',
        status: 'active',
        items: {
          data: [{ price: { id: 'price_ent_mapped' } } as Stripe.SubscriptionItem],
        } as Stripe.ApiList<Stripe.SubscriptionItem>,
      };

      const mockEvent = {
        type: 'customer.subscription.updated',
        data: { object: mockSubscription },
      } as unknown as Stripe.Event;

      const constructEvent = jest.fn().mockReturnValue(mockEvent);
      const stripeMock = { webhooks: { constructEvent } };

      licenseRepositoryMock.findFirstWhere.mockResolvedValue({ id: 'lic_ent' });
      licenseRepositoryMock.updateById.mockResolvedValue({});

      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);
      await svc.handleWebhook('sig', Buffer.from('body'));

      expect(licenseRepositoryMock.updateById).toHaveBeenCalledWith(
        'lic_ent',
        expect.objectContaining({
          tier: LicenseTier.COMMERCIAL_ENTERPRISE,
          status: LicenseStatus.ACTIVE,
          maxNodes: 999,
        })
      );
    });

    it('should handle customer.subscription.updated with inactive status', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      process.env.STRIPE_PRICE_STARTER = 'price_st_inactive';

      const mockSubscription: Partial<Stripe.Subscription> = {
        id: 'sub_inactive',
        status: 'past_due',
        items: {
          data: [{ price: { id: 'price_st_inactive' } } as Stripe.SubscriptionItem],
        } as Stripe.ApiList<Stripe.SubscriptionItem>,
      };

      const mockEvent = {
        type: 'customer.subscription.updated',
        data: { object: mockSubscription },
      } as unknown as Stripe.Event;

      const constructEvent = jest.fn().mockReturnValue(mockEvent);
      const stripeMock = { webhooks: { constructEvent } };

      licenseRepositoryMock.findFirstWhere.mockResolvedValue({ id: 'lic_x' });
      licenseRepositoryMock.updateById.mockResolvedValue({});

      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);
      await svc.handleWebhook('sig', Buffer.from('body'));

      expect(licenseRepositoryMock.updateById).toHaveBeenCalledWith(
        'lic_x',
        expect.objectContaining({ status: LicenseStatus.EXPIRED })
      );
    });

    it('should handle customer.subscription.updated with unknown priceId gracefully', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

      const mockSubscription: Partial<Stripe.Subscription> = {
        id: 'sub_unk',
        status: 'active',
        items: {
          data: [{ price: { id: 'price_nonexistent' } } as Stripe.SubscriptionItem],
        } as Stripe.ApiList<Stripe.SubscriptionItem>,
      };

      const mockEvent = {
        type: 'customer.subscription.updated',
        data: { object: mockSubscription },
      } as unknown as Stripe.Event;

      const constructEvent = jest.fn().mockReturnValue(mockEvent);
      const stripeMock = { webhooks: { constructEvent } };

      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);
      await expect(svc.handleWebhook('sig', Buffer.from('body'))).resolves.not.toThrow();
      expect(licenseRepositoryMock.updateById).not.toHaveBeenCalled();
    });

    it('should handle customer.subscription.deleted and downgrade to FREE', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

      const mockSubscription: Partial<Stripe.Subscription> = { id: 'sub_del' };
      const mockEvent = {
        type: 'customer.subscription.deleted',
        data: { object: mockSubscription },
      } as unknown as Stripe.Event;

      const constructEvent = jest.fn().mockReturnValue(mockEvent);
      const stripeMock = { webhooks: { constructEvent } };

      licenseRepositoryMock.findFirstWhere.mockResolvedValue({ id: 'lic_to_downgrade' });
      licenseRepositoryMock.updateById.mockResolvedValue({});

      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);
      await svc.handleWebhook('sig', Buffer.from('body'));

      expect(licenseRepositoryMock.updateById).toHaveBeenCalledWith(
        'lic_to_downgrade',
        expect.objectContaining({
          tier: LicenseTier.FREE,
          status: LicenseStatus.EXPIRED,
          maxNodes: 1,
          maxConcurrentJobs: 2,
        })
      );
    });

    it('should handle customer.subscription.deleted when license not found', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

      const mockEvent = {
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_nolic' } },
      } as unknown as Stripe.Event;

      const constructEvent = jest.fn().mockReturnValue(mockEvent);
      const stripeMock = { webhooks: { constructEvent } };
      licenseRepositoryMock.findFirstWhere.mockResolvedValue(null);

      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);
      await expect(svc.handleWebhook('sig', Buffer.from('body'))).resolves.not.toThrow();
      expect(licenseRepositoryMock.updateById).not.toHaveBeenCalled();
    });

    it('should handle invoice.payment_failed with known license', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

      const mockEvent = {
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_fail' } },
      } as unknown as Stripe.Event;

      const constructEvent = jest.fn().mockReturnValue(mockEvent);
      const stripeMock = { webhooks: { constructEvent } };
      licenseRepositoryMock.findFirstWhere.mockResolvedValue({ id: 'lic_fail' });

      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);
      await expect(svc.handleWebhook('sig', Buffer.from('body'))).resolves.not.toThrow();
      // No downgrade on first failure
      expect(licenseRepositoryMock.updateById).not.toHaveBeenCalled();
    });

    it('should handle invoice.payment_failed when no license found', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

      const mockEvent = {
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_unknown' } },
      } as unknown as Stripe.Event;

      const constructEvent = jest.fn().mockReturnValue(mockEvent);
      const stripeMock = { webhooks: { constructEvent } };
      licenseRepositoryMock.findFirstWhere.mockResolvedValue(null);

      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);
      await expect(svc.handleWebhook('sig', Buffer.from('body'))).resolves.not.toThrow();
    });

    it('should handle unrecognized event types without throwing', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

      const mockEvent = {
        type: 'some.unknown.event',
        data: { object: {} },
      } as unknown as Stripe.Event;

      const constructEvent = jest.fn().mockReturnValue(mockEvent);
      const stripeMock = { webhooks: { constructEvent } };

      const svc = await buildConfiguredService(licenseRepositoryMock, stripeMock);
      await expect(svc.handleWebhook('sig', Buffer.from('body'))).resolves.not.toThrow();
    });
  });
});
