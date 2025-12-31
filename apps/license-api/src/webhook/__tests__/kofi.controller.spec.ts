import { LicenseTier, PaymentProvider } from '.prisma/license-client';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import { SecurityLoggerService } from '../../security/security-logger.service';
import { WebhookService } from '../_services/webhook.service';
import { KofiController } from '../kofi.controller';

describe('KofiController', () => {
  let controller: KofiController;
  let webhookService: jest.Mocked<WebhookService>;
  let configService: jest.Mocked<ConfigService>;
  let securityLogger: jest.Mocked<SecurityLoggerService>;

  const VERIFICATION_TOKEN = 'test-verification-token-123';

  beforeEach(async () => {
    webhookService = {
      processNewSubscription: jest.fn().mockResolvedValue({ success: true, licenseId: 'lic-123' }),
    } as unknown as jest.Mocked<WebhookService>;

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'KOFI_VERIFICATION_TOKEN') return VERIFICATION_TOKEN;
        return null;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    securityLogger = {
      logWebhookSignatureInvalid: jest.fn(),
    } as unknown as jest.Mocked<SecurityLoggerService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [KofiController],
      providers: [
        { provide: WebhookService, useValue: webhookService },
        { provide: ConfigService, useValue: configService },
        { provide: SecurityLoggerService, useValue: securityLogger },
      ],
    }).compile();

    controller = module.get<KofiController>(KofiController);
  });

  describe('handleWebhook', () => {
    const validPayload = {
      verification_token: VERIFICATION_TOKEN,
      type: 'Donation',
      from_name: 'Test User',
      email: 'test@example.com',
      amount: '10.00',
      currency: 'USD',
      message: 'Thanks for BitBonsai!',
      timestamp: '2025-12-25T12:00:00Z',
      transaction_id: 'txn_123',
    };

    const mockRequest = {
      ip: '1.2.3.4',
      socket: { remoteAddress: '1.2.3.4' },
    } as any;

    it('should accept valid Ko-fi webhook', async () => {
      const result = await controller.handleWebhook(validPayload, mockRequest);

      expect(result).toEqual({ received: true });
      expect(webhookService.processNewSubscription).toHaveBeenCalledWith({
        provider: PaymentProvider.KOFI,
        providerEventId: 'txn_123',
        email: 'test@example.com',
        tier: LicenseTier.FREE,
        providerCustomerId: 'test@example.com',
        rawPayload: validPayload,
      });
    });

    it('should throw if verification token missing', async () => {
      configService.get = jest.fn().mockReturnValue(null);

      await expect(controller.handleWebhook(validPayload, mockRequest)).rejects.toThrow(
        'KOFI_VERIFICATION_TOKEN not configured'
      );

      expect(securityLogger.logWebhookSignatureInvalid).toHaveBeenCalledWith('kofi', '1.2.3.4');
    });

    it('should throw if verification token invalid', async () => {
      const invalidPayload = {
        ...validPayload,
        verification_token: 'wrong-token',
      };

      await expect(controller.handleWebhook(invalidPayload, mockRequest)).rejects.toThrow(
        'Invalid Ko-fi verification token'
      );

      expect(securityLogger.logWebhookSignatureInvalid).toHaveBeenCalledWith('kofi', '1.2.3.4');
    });

    it('should use timing-safe comparison for token verification', async () => {
      const timingSafeEqualSpy = jest.spyOn(crypto, 'timingSafeEqual');

      await controller.handleWebhook(validPayload, mockRequest);

      expect(timingSafeEqualSpy).toHaveBeenCalled();
    });

    it('should handle webhook service errors gracefully', async () => {
      webhookService.processNewSubscription.mockRejectedValue(new Error('DB connection failed'));

      await expect(controller.handleWebhook(validPayload, mockRequest)).rejects.toThrow(
        'DB connection failed'
      );
    });

    it('should extract IP from various request sources', async () => {
      const requestWithoutIp = {
        socket: { remoteAddress: '5.6.7.8' },
      } as any;

      await controller.handleWebhook(validPayload, requestWithoutIp);

      // Should not throw - IP extraction should work
      expect(webhookService.processNewSubscription).toHaveBeenCalled();
    });

    it('should handle missing email field', async () => {
      const payloadNoEmail = {
        ...validPayload,
        email: undefined,
      };

      await controller.handleWebhook(payloadNoEmail as any, mockRequest);

      expect(webhookService.processNewSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          email: undefined,
        })
      );
    });

    it('should handle missing transaction ID', async () => {
      const payloadNoTxn = {
        ...validPayload,
        transaction_id: undefined,
      };

      await controller.handleWebhook(payloadNoTxn as any, mockRequest);

      expect(webhookService.processNewSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          providerEventId: undefined,
        })
      );
    });
  });

  describe('idempotency', () => {
    it('should handle duplicate transaction IDs via webhook service', async () => {
      const payload = {
        verification_token: VERIFICATION_TOKEN,
        type: 'Donation',
        from_name: 'Test User',
        email: 'test@example.com',
        amount: '10.00',
        currency: 'USD',
        message: 'Thanks!',
        timestamp: '2025-12-25T12:00:00Z',
        transaction_id: 'txn_duplicate',
      };

      const mockRequest = {
        ip: '1.2.3.4',
        socket: { remoteAddress: '1.2.3.4' },
      } as any;

      // First call succeeds
      webhookService.processNewSubscription.mockResolvedValueOnce({
        success: true,
        licenseId: 'lic-123',
      });

      // Second call returns cached result (idempotent)
      webhookService.processNewSubscription.mockResolvedValueOnce({
        success: true,
        licenseId: 'lic-123',
      });

      const result1 = await controller.handleWebhook(payload, mockRequest);
      const result2 = await controller.handleWebhook(payload, mockRequest);

      expect(result1).toEqual({ received: true });
      expect(result2).toEqual({ received: true });
      expect(webhookService.processNewSubscription).toHaveBeenCalledTimes(2);
    });
  });
});
