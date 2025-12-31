import { LicenseTier, PaymentProvider } from '.prisma/license-client';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import { SecurityLoggerService } from '../../security/security-logger.service';
import { WebhookService } from '../_services/webhook.service';
import { PatreonController } from '../patreon.controller';

describe('PatreonController', () => {
  let controller: PatreonController;
  let webhookService: jest.Mocked<WebhookService>;
  let configService: jest.Mocked<ConfigService>;
  let securityLogger: jest.Mocked<SecurityLoggerService>;

  const WEBHOOK_SECRET = 'test-patreon-webhook-secret';

  beforeEach(async () => {
    webhookService = {
      processNewSubscription: jest.fn().mockResolvedValue({ success: true, licenseId: 'lic-456' }),
      processUpgrade: jest.fn().mockResolvedValue({ success: true, licenseId: 'lic-456' }),
      processCancellation: jest.fn().mockResolvedValue({ success: true, licenseId: 'lic-456' }),
    } as unknown as jest.Mocked<WebhookService>;

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'PATREON_WEBHOOK_SECRET') return WEBHOOK_SECRET;
        return null;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    securityLogger = {
      logWebhookSignatureInvalid: jest.fn(),
    } as unknown as jest.Mocked<SecurityLoggerService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PatreonController],
      providers: [
        { provide: WebhookService, useValue: webhookService },
        { provide: ConfigService, useValue: configService },
        { provide: SecurityLoggerService, useValue: securityLogger },
      ],
    }).compile();

    controller = module.get<PatreonController>(PatreonController);
  });

  describe('handleWebhook', () => {
    const createValidPayload = (event: string = 'members:pledge:create') => ({
      data: {
        id: 'member_123',
        attributes: {
          email: 'patron@example.com',
          patron_status: 'active_patron',
          currently_entitled_amount_cents: 1500, // $15 = PRO tier
        },
        relationships: {
          currently_entitled_tiers: {
            data: [{ id: 'tier_pro', type: 'tier' }],
          },
        },
      },
      included: [
        {
          id: 'tier_pro',
          type: 'tier',
          attributes: {
            title: 'Pro',
            amount_cents: 1500,
          },
        },
      ],
    });

    const createSignature = (payload: string): string => {
      return crypto.createHmac('md5', WEBHOOK_SECRET).update(payload).digest('hex');
    };

    const mockRequest = {
      ip: '1.2.3.4',
      socket: { remoteAddress: '1.2.3.4' },
    } as any;

    describe('members:pledge:create', () => {
      it('should process new pledge successfully', async () => {
        const payload = createValidPayload('members:pledge:create');
        const payloadStr = JSON.stringify(payload);
        const signature = createSignature(payloadStr);

        const result = await controller.handleWebhook(
          signature,
          'members:pledge:create',
          payload,
          mockRequest
        );

        expect(result).toEqual({ received: true });
        expect(webhookService.processNewSubscription).toHaveBeenCalledWith({
          provider: PaymentProvider.PATREON,
          providerEventId: expect.stringContaining('members:pledge:create:member_123'),
          email: 'patron@example.com',
          tier: LicenseTier.PATREON_PRO,
          providerCustomerId: 'member_123',
          rawPayload: payload,
        });
      });
    });

    describe('members:pledge:update', () => {
      it('should process pledge upgrade successfully', async () => {
        const payload = createValidPayload('members:pledge:update');
        payload.data.attributes.currently_entitled_amount_cents = 2500; // Upgraded to Ultimate
        const payloadStr = JSON.stringify(payload);
        const signature = createSignature(payloadStr);

        const result = await controller.handleWebhook(
          signature,
          'members:pledge:update',
          payload,
          mockRequest
        );

        expect(result).toEqual({ received: true });
        expect(webhookService.processUpgrade).toHaveBeenCalledWith({
          provider: PaymentProvider.PATREON,
          providerEventId: expect.stringContaining('members:pledge:update:member_123'),
          providerCustomerId: 'member_123',
          newTier: LicenseTier.PATREON_ULTIMATE,
          rawPayload: payload,
        });
      });
    });

    describe('members:pledge:delete', () => {
      it('should process pledge cancellation successfully', async () => {
        const payload = createValidPayload('members:pledge:delete');
        const payloadStr = JSON.stringify(payload);
        const signature = createSignature(payloadStr);

        const result = await controller.handleWebhook(
          signature,
          'members:pledge:delete',
          payload,
          mockRequest
        );

        expect(result).toEqual({ received: true });
        expect(webhookService.processCancellation).toHaveBeenCalledWith({
          provider: PaymentProvider.PATREON,
          providerEventId: expect.stringContaining('members:pledge:delete:member_123'),
          providerCustomerId: 'member_123',
          rawPayload: payload,
        });
      });
    });

    describe('signature validation', () => {
      it('should reject webhook with missing signature', async () => {
        const payload = createValidPayload();

        await expect(
          controller.handleWebhook('', 'members:pledge:create', payload, mockRequest)
        ).rejects.toThrow('Invalid Patreon webhook signature');

        expect(securityLogger.logWebhookSignatureInvalid).toHaveBeenCalledWith(
          'patreon',
          '1.2.3.4'
        );
      });

      it('should reject webhook with invalid signature', async () => {
        const payload = createValidPayload();
        const invalidSignature = 'invalid_signature_abc123';

        await expect(
          controller.handleWebhook(invalidSignature, 'members:pledge:create', payload, mockRequest)
        ).rejects.toThrow('Invalid Patreon webhook signature');
      });

      it('should throw if PATREON_WEBHOOK_SECRET not configured', async () => {
        configService.get = jest.fn().mockReturnValue(null);
        const payload = createValidPayload();

        await expect(
          controller.handleWebhook('sig', 'members:pledge:create', payload, mockRequest)
        ).rejects.toThrow('PATREON_WEBHOOK_SECRET not configured');
      });

      it('should use MD5 HMAC for signature verification', async () => {
        const payload = createValidPayload();
        const payloadStr = JSON.stringify(payload);
        const signature = createSignature(payloadStr);

        await controller.handleWebhook(signature, 'members:pledge:create', payload, mockRequest);

        expect(webhookService.processNewSubscription).toHaveBeenCalled();
      });
    });

    describe('tier mapping', () => {
      it('should map $5 pledge to PATREON_SUPPORTER', async () => {
        const payload = createValidPayload();
        payload.data.attributes.currently_entitled_amount_cents = 500;
        const payloadStr = JSON.stringify(payload);
        const signature = createSignature(payloadStr);

        await controller.handleWebhook(signature, 'members:pledge:create', payload, mockRequest);

        expect(webhookService.processNewSubscription).toHaveBeenCalledWith(
          expect.objectContaining({
            tier: LicenseTier.PATREON_SUPPORTER,
          })
        );
      });

      it('should map $10 pledge to PATREON_PLUS', async () => {
        const payload = createValidPayload();
        payload.data.attributes.currently_entitled_amount_cents = 1000;
        const payloadStr = JSON.stringify(payload);
        const signature = createSignature(payloadStr);

        await controller.handleWebhook(signature, 'members:pledge:create', payload, mockRequest);

        expect(webhookService.processNewSubscription).toHaveBeenCalledWith(
          expect.objectContaining({
            tier: LicenseTier.PATREON_PLUS,
          })
        );
      });

      it('should map tier by name if included in payload', async () => {
        const payload = createValidPayload();
        payload.included = [
          {
            id: 'tier_ultimate',
            type: 'tier',
            attributes: {
              title: 'Ultimate',
              amount_cents: 2500,
            },
          },
        ];
        payload.data.relationships!.currently_entitled_tiers!.data = [
          { id: 'tier_ultimate', type: 'tier' },
        ];
        const payloadStr = JSON.stringify(payload);
        const signature = createSignature(payloadStr);

        await controller.handleWebhook(signature, 'members:pledge:create', payload, mockRequest);

        expect(webhookService.processNewSubscription).toHaveBeenCalledWith(
          expect.objectContaining({
            tier: LicenseTier.PATREON_ULTIMATE,
          })
        );
      });
    });

    describe('event ID generation', () => {
      it('should generate deterministic event ID', async () => {
        const payload = createValidPayload();
        const payloadStr = JSON.stringify(payload);
        const signature = createSignature(payloadStr);

        await controller.handleWebhook(signature, 'members:pledge:create', payload, mockRequest);

        const call = webhookService.processNewSubscription.mock.calls[0][0];
        expect(call.providerEventId).toMatch(/^members:pledge:create:member_123:\d+$/);
      });

      it('should use member ID in event ID for idempotency', async () => {
        const payload = createValidPayload();
        const payloadStr = JSON.stringify(payload);
        const signature = createSignature(payloadStr);

        await controller.handleWebhook(signature, 'members:pledge:create', payload, mockRequest);

        const call = webhookService.processNewSubscription.mock.calls[0][0];
        expect(call.providerEventId).toContain('member_123');
      });
    });

    describe('unhandled events', () => {
      it('should log warning for unhandled event types', async () => {
        const payload = createValidPayload();
        const payloadStr = JSON.stringify(payload);
        const signature = createSignature(payloadStr);

        const logSpy = jest.spyOn(controller['logger'], 'warn');

        await controller.handleWebhook(signature, 'members:unknown:event', payload, mockRequest);

        expect(logSpy).toHaveBeenCalledWith('Unhandled Patreon event: members:unknown:event');
        expect(webhookService.processNewSubscription).not.toHaveBeenCalled();
      });
    });
  });
});
