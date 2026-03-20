import type { RawBodyRequest } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { StripeController } from '../../stripe.controller';
import { StripeService } from '../../stripe.service';

describe('StripeController', () => {
  let controller: StripeController;

  const mockStripeService = {
    isConfigured: jest.fn(),
    createCheckoutSession: jest.fn(),
    handleWebhook: jest.fn(),
    getPlans: jest.fn(),
    getCustomerPortalUrl: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeController],
      providers: [{ provide: StripeService, useValue: mockStripeService }],
    }).compile();

    controller = module.get<StripeController>(StripeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createCheckout', () => {
    it('should create checkout session and return sessionId and url', async () => {
      mockStripeService.isConfigured.mockReturnValue(true);
      const session = {
        sessionId: 'cs_test_123',
        url: 'https://checkout.stripe.com/pay/cs_test_123',
      };
      mockStripeService.createCheckoutSession.mockResolvedValue(session);

      const body = { email: 'user@example.com', priceId: 'price_abc123' };
      const result = await controller.createCheckout(body);

      expect(mockStripeService.isConfigured).toHaveBeenCalledTimes(1);
      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@example.com',
          priceId: 'price_abc123',
        })
      );
      expect(result).toEqual(session);
    });

    it('should use provided returnUrl to build successUrl and cancelUrl', async () => {
      mockStripeService.isConfigured.mockReturnValue(true);
      mockStripeService.createCheckoutSession.mockResolvedValue({ sessionId: 's', url: 'u' });

      const body = {
        email: 'user@example.com',
        priceId: 'price_abc',
        returnUrl: 'https://myapp.com/settings',
      };
      await controller.createCheckout(body);

      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith({
        email: 'user@example.com',
        priceId: 'price_abc',
        successUrl: 'https://myapp.com/settings&stripe=success',
        cancelUrl: 'https://myapp.com/settings&stripe=cancelled',
      });
    });

    it('should throw BadRequestException when Stripe is not configured', async () => {
      mockStripeService.isConfigured.mockReturnValue(false);

      await expect(
        controller.createCheckout({ email: 'user@example.com', priceId: 'price_123' })
      ).rejects.toThrow(BadRequestException);

      expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('should propagate service errors', async () => {
      mockStripeService.isConfigured.mockReturnValue(true);
      mockStripeService.createCheckoutSession.mockRejectedValue(new Error('stripe api error'));

      await expect(controller.createCheckout({ email: 'u@x.com', priceId: 'p' })).rejects.toThrow(
        'stripe api error'
      );
    });
  });

  describe('handleWebhook', () => {
    const buildRequest = (rawBody: Buffer | undefined): RawBodyRequest<Request> =>
      ({ rawBody }) as RawBodyRequest<Request>;

    it('should process webhook and return { received: true }', async () => {
      mockStripeService.handleWebhook.mockResolvedValue(undefined);
      const rawBody = Buffer.from('raw-body');

      const result = await controller.handleWebhook('sig_test', buildRequest(rawBody));

      expect(mockStripeService.handleWebhook).toHaveBeenCalledWith('sig_test', rawBody);
      expect(result).toEqual({ received: true });
    });

    it('should throw BadRequestException when signature is missing', async () => {
      await expect(controller.handleWebhook('', buildRequest(Buffer.from('body')))).rejects.toThrow(
        BadRequestException
      );

      expect(mockStripeService.handleWebhook).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when rawBody is missing', async () => {
      await expect(controller.handleWebhook('sig_test', buildRequest(undefined))).rejects.toThrow(
        BadRequestException
      );

      expect(mockStripeService.handleWebhook).not.toHaveBeenCalled();
    });

    it('should propagate service errors', async () => {
      mockStripeService.handleWebhook.mockRejectedValue(new Error('invalid signature'));

      await expect(
        controller.handleWebhook('bad-sig', buildRequest(Buffer.from('body')))
      ).rejects.toThrow('invalid signature');
    });
  });

  describe('getPlans', () => {
    it('should return plans with configured: true when Stripe is configured', async () => {
      mockStripeService.isConfigured.mockReturnValue(true);
      const plans = [{ id: 'plan_1', name: 'Business Starter' }];
      mockStripeService.getPlans.mockResolvedValue(plans);

      const result = await controller.getPlans();

      expect(mockStripeService.getPlans).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ plans, configured: true });
    });

    it('should return empty plans with configured: false when Stripe is not configured', async () => {
      mockStripeService.isConfigured.mockReturnValue(false);

      const result = await controller.getPlans();

      expect(mockStripeService.getPlans).not.toHaveBeenCalled();
      expect(result).toEqual({ plans: [], configured: false });
    });

    it('should propagate service errors', async () => {
      mockStripeService.isConfigured.mockReturnValue(true);
      mockStripeService.getPlans.mockRejectedValue(new Error('plans error'));

      await expect(controller.getPlans()).rejects.toThrow('plans error');
    });
  });

  describe('getStatus', () => {
    it('should return { configured: true } when Stripe is configured', async () => {
      mockStripeService.isConfigured.mockReturnValue(true);

      const result = await controller.getStatus();

      expect(result).toEqual({ configured: true });
    });

    it('should return { configured: false } when Stripe is not configured', async () => {
      mockStripeService.isConfigured.mockReturnValue(false);

      const result = await controller.getStatus();

      expect(result).toEqual({ configured: false });
    });
  });

  describe('getPortalUrl', () => {
    it('should call getCustomerPortalUrl and return url', async () => {
      mockStripeService.isConfigured.mockReturnValue(true);
      mockStripeService.getCustomerPortalUrl.mockResolvedValue(
        'https://billing.stripe.com/session/123'
      );

      const body = { customerId: 'cus_abc123', returnUrl: 'https://myapp.com/settings' };
      const result = await controller.getPortalUrl(body);

      expect(mockStripeService.getCustomerPortalUrl).toHaveBeenCalledWith(
        'cus_abc123',
        'https://myapp.com/settings'
      );
      expect(result).toEqual({ url: 'https://billing.stripe.com/session/123' });
    });

    it('should use default returnUrl when not provided', async () => {
      mockStripeService.isConfigured.mockReturnValue(true);
      mockStripeService.getCustomerPortalUrl.mockResolvedValue(
        'https://billing.stripe.com/session/456'
      );

      await controller.getPortalUrl({ customerId: 'cus_xyz' });

      expect(mockStripeService.getCustomerPortalUrl).toHaveBeenCalledWith(
        'cus_xyz',
        expect.stringContaining('/settings?tab=license')
      );
    });

    it('should throw BadRequestException when Stripe is not configured', async () => {
      mockStripeService.isConfigured.mockReturnValue(false);

      await expect(controller.getPortalUrl({ customerId: 'cus_abc' })).rejects.toThrow(
        BadRequestException
      );

      expect(mockStripeService.getCustomerPortalUrl).not.toHaveBeenCalled();
    });

    it('should propagate service errors', async () => {
      mockStripeService.isConfigured.mockReturnValue(true);
      mockStripeService.getCustomerPortalUrl.mockRejectedValue(new Error('portal error'));

      await expect(
        controller.getPortalUrl({ customerId: 'cus_abc', returnUrl: 'https://app.com' })
      ).rejects.toThrow('portal error');
    });
  });
});
