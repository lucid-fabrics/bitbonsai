import {
  LicenseStatus,
  LicenseTier,
  PaymentProvider,
  WebhookEventStatus,
  WebhookEventType,
} from '.prisma/license-client';
import { CryptoService } from '../../crypto/crypto.service';
import { EmailService } from '../../email/email.service';
import { LicenseRepository } from '../../license/_repositories/license.repository';
import { LicenseService } from '../../license/_services/license.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookService } from '../_services/webhook.service';

describe('WebhookService (Integration)', () => {
  let service: WebhookService;
  let licenseService: LicenseService;
  let prisma: jest.Mocked<PrismaService>;
  let emailService: jest.Mocked<EmailService>;
  let repository: jest.Mocked<LicenseRepository>;
  let cryptoService: jest.Mocked<CryptoService>;

  const mockLicense = {
    id: 'license-123',
    key: 'BITBONSAI-PAT-test.signature',
    email: 'test@example.com',
    tier: LicenseTier.PATREON_PRO,
    status: LicenseStatus.ACTIVE,
    maxNodes: 5,
    maxConcurrentJobs: 10,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    provider: PaymentProvider.PATREON,
    providerCustomerId: 'cust_123',
    providerEmail: 'test@example.com',
    revokedAt: null,
    revokedReason: null,
  };

  const mockWebhookEvent = {
    id: 'event-123',
    createdAt: new Date(),
    provider: PaymentProvider.PATREON,
    providerEventId: 'evt_123',
    eventType: WebhookEventType.SUBSCRIPTION_CREATED,
    status: WebhookEventStatus.PENDING,
    rawPayload: {},
    error: null,
    processedAt: null,
    licenseId: null,
  };

  beforeEach(() => {
    prisma = {
      webhookEvent: {
        create: jest.fn().mockResolvedValue(mockWebhookEvent),
        update: jest
          .fn()
          .mockResolvedValue({ ...mockWebhookEvent, status: WebhookEventStatus.PROCESSED }),
      },
    } as unknown as jest.Mocked<PrismaService>;

    emailService = {
      sendLicenseEmail: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EmailService>;

    repository = {
      create: jest.fn().mockResolvedValue(mockLicense),
      findById: jest.fn().mockResolvedValue(mockLicense),
      findByKey: jest.fn().mockResolvedValue(mockLicense),
      findByEmail: jest.fn().mockResolvedValue([mockLicense]),
      findByProviderCustomerId: jest.fn().mockResolvedValue(mockLicense),
      findAll: jest.fn().mockResolvedValue([mockLicense]),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue(mockLicense),
      revoke: jest.fn().mockResolvedValue({ ...mockLicense, status: LicenseStatus.REVOKED }),
    } as unknown as jest.Mocked<LicenseRepository>;

    cryptoService = {
      generateLicenseKey: jest.fn().mockReturnValue('BITBONSAI-PAT-test.signature'),
      verifyLicenseKey: jest.fn().mockReturnValue({ payload: mockLicense, signature: 'sig' }),
    } as unknown as jest.Mocked<CryptoService>;

    licenseService = new LicenseService(repository, cryptoService);

    service = new WebhookService(prisma, licenseService, emailService);
  });

  describe('processNewSubscription', () => {
    it('should create license and send email on new subscription', async () => {
      const result = await service.processNewSubscription({
        provider: PaymentProvider.PATREON,
        providerEventId: 'evt_123',
        email: 'test@example.com',
        tier: LicenseTier.PATREON_PRO,
        providerCustomerId: 'cust_123',
        rawPayload: { test: true },
      });

      expect(result.success).toBe(true);
      expect(result.licenseId).toBe('license-123');
      expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: PaymentProvider.PATREON,
            eventType: WebhookEventType.SUBSCRIPTION_CREATED,
          }),
        })
      );
      expect(repository.create).toHaveBeenCalled();
      // Email is fire-and-forget, so we just check it was called
      expect(emailService.sendLicenseEmail).toHaveBeenCalled();
    });

    it('should not fail webhook if email sending fails', async () => {
      emailService.sendLicenseEmail.mockRejectedValue(new Error('Email failed'));

      const result = await service.processNewSubscription({
        provider: PaymentProvider.PATREON,
        providerEventId: 'evt_123',
        email: 'test@example.com',
        tier: LicenseTier.PATREON_PRO,
        providerCustomerId: 'cust_123',
        rawPayload: { test: true },
      });

      // Should still succeed even if email fails
      expect(result.success).toBe(true);
    });

    it('should handle license creation failure', async () => {
      repository.create.mockRejectedValue(new Error('Database error'));

      const result = await service.processNewSubscription({
        provider: PaymentProvider.STRIPE,
        providerEventId: 'evt_456',
        email: 'test@example.com',
        tier: LicenseTier.COMMERCIAL_STARTER,
        providerCustomerId: 'cust_456',
        rawPayload: { test: true },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
      expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WebhookEventStatus.FAILED,
            error: 'Database error',
          }),
        })
      );
    });
  });

  describe('processUpgrade', () => {
    it('should upgrade existing license', async () => {
      const upgradedLicense = { ...mockLicense, tier: LicenseTier.PATREON_ULTIMATE };
      repository.update.mockResolvedValue(upgradedLicense);

      const result = await service.processUpgrade({
        provider: PaymentProvider.PATREON,
        providerEventId: 'evt_upgrade',
        providerCustomerId: 'cust_123',
        newTier: LicenseTier.PATREON_ULTIMATE,
        rawPayload: { test: true },
      });

      expect(result.success).toBe(true);
      expect(repository.findByProviderCustomerId).toHaveBeenCalledWith(
        PaymentProvider.PATREON,
        'cust_123'
      );
    });

    it('should return error if license not found for upgrade', async () => {
      repository.findByProviderCustomerId.mockResolvedValue(null);

      const result = await service.processUpgrade({
        provider: PaymentProvider.PATREON,
        providerEventId: 'evt_upgrade',
        providerCustomerId: 'nonexistent',
        newTier: LicenseTier.PATREON_ULTIMATE,
        rawPayload: { test: true },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('License not found for customer');
    });
  });

  describe('processCancellation', () => {
    it('should revoke license on cancellation', async () => {
      const result = await service.processCancellation({
        provider: PaymentProvider.STRIPE,
        providerEventId: 'evt_cancel',
        providerCustomerId: 'cust_123',
        rawPayload: { test: true },
      });

      expect(result.success).toBe(true);
      expect(repository.revoke).toHaveBeenCalledWith(
        'license-123',
        'Subscription cancelled via STRIPE'
      );
    });

    it('should return error if license not found for cancellation', async () => {
      repository.findByProviderCustomerId.mockResolvedValue(null);

      const result = await service.processCancellation({
        provider: PaymentProvider.KOFI,
        providerEventId: 'evt_cancel',
        providerCustomerId: 'nonexistent',
        rawPayload: { test: true },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('License not found for customer');
    });
  });
});
