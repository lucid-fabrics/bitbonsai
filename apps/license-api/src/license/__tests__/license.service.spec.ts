import { LicenseStatus, LicenseTier, PaymentProvider } from '.prisma/license-client';
import { NotFoundException } from '@nestjs/common';
import { CryptoService } from '../../crypto/crypto.service';
import { LicenseTierDto } from '../_dtos';
import { LicenseRepository } from '../_repositories/license.repository';
import { LicenseService } from '../_services/license.service';

describe('LicenseService', () => {
  let service: LicenseService;
  let repository: jest.Mocked<LicenseRepository>;
  let cryptoService: jest.Mocked<CryptoService>;

  const mockLicense = {
    id: 'test-id',
    key: 'BITBONSAI-PAT-test.signature',
    email: 'test@example.com',
    tier: LicenseTier.PATREON_PRO,
    status: LicenseStatus.ACTIVE,
    maxNodes: 5,
    maxConcurrentJobs: 10,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    provider: PaymentProvider.MANUAL,
    providerCustomerId: null,
    providerEmail: null,
    revokedAt: null,
    revokedReason: null,
  };

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByKey: jest.fn(),
      findByEmail: jest.fn(),
      findByProviderCustomerId: jest.fn(),
      findAll: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      revoke: jest.fn(),
    } as unknown as jest.Mocked<LicenseRepository>;

    cryptoService = {
      generateLicenseKey: jest.fn(),
      verifyLicenseKey: jest.fn(),
    } as unknown as jest.Mocked<CryptoService>;

    service = new LicenseService(repository, cryptoService);
  });

  describe('create', () => {
    it('should create a license with default tier limits', async () => {
      const dto = { email: 'test@example.com', tier: LicenseTierDto.PATREON_PRO };
      cryptoService.generateLicenseKey.mockReturnValue('BITBONSAI-PAT-payload.signature');
      repository.create.mockResolvedValue(mockLicense);

      const result = await service.create(dto);

      expect(cryptoService.generateLicenseKey).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          tier: 'PATREON_PRO',
          maxNodes: 5,
          maxConcurrentJobs: 10,
        })
      );
      expect(repository.create).toHaveBeenCalled();
      expect(result).toEqual(mockLicense);
    });

    it('should use custom limits when provided', async () => {
      const dto = {
        email: 'test@example.com',
        tier: LicenseTierDto.PATREON_PRO,
        maxNodes: 10,
        maxConcurrentJobs: 20,
      };
      cryptoService.generateLicenseKey.mockReturnValue('BITBONSAI-PAT-payload.signature');
      repository.create.mockResolvedValue(mockLicense);

      await service.create(dto);

      expect(cryptoService.generateLicenseKey).toHaveBeenCalledWith(
        expect.objectContaining({
          maxNodes: 10,
          maxConcurrentJobs: 20,
        })
      );
    });
  });

  describe('verify', () => {
    it('should return valid for a valid license key', async () => {
      const payload = {
        email: 'test@example.com',
        tier: 'PATREON_PRO',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        expiresAt: null,
        issuedAt: new Date().toISOString(),
      };
      cryptoService.verifyLicenseKey.mockReturnValue({ payload, signature: 'sig' });
      repository.findByKey.mockResolvedValue(mockLicense);

      const result = await service.verify({ licenseKey: 'valid-key' });

      expect(result.valid).toBe(true);
      expect(result.license).toEqual(payload);
    });

    it('should return invalid for invalid signature', async () => {
      cryptoService.verifyLicenseKey.mockReturnValue(null);

      const result = await service.verify({ licenseKey: 'invalid-key' });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid license key signature');
    });

    it('should return invalid for expired license', async () => {
      const expiredDate = new Date(Date.now() - 86400000).toISOString();
      cryptoService.verifyLicenseKey.mockReturnValue({
        payload: {
          email: 'test@example.com',
          tier: 'FREE',
          maxNodes: 1,
          maxConcurrentJobs: 2,
          expiresAt: expiredDate,
          issuedAt: new Date().toISOString(),
        },
        signature: 'sig',
      });

      const result = await service.verify({ licenseKey: 'expired-key' });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('License expired');
    });

    it('should return invalid for revoked license', async () => {
      cryptoService.verifyLicenseKey.mockReturnValue({
        payload: {
          email: 'test@example.com',
          tier: 'FREE',
          maxNodes: 1,
          maxConcurrentJobs: 2,
          expiresAt: null,
          issuedAt: new Date().toISOString(),
        },
        signature: 'sig',
      });
      repository.findByKey.mockResolvedValue({
        ...mockLicense,
        status: LicenseStatus.REVOKED,
      });

      const result = await service.verify({ licenseKey: 'revoked-key' });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('License revoked');
    });
  });

  describe('findById', () => {
    it('should return license when found', async () => {
      repository.findById.mockResolvedValue(mockLicense);

      const result = await service.findById('test-id');

      expect(result).toEqual(mockLicense);
    });

    it('should throw NotFoundException when not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('not-found')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByEmail', () => {
    it('should return licenses for email', async () => {
      repository.findByEmail.mockResolvedValue([mockLicense]);

      const result = await service.findByEmail('test@example.com');

      expect(result).toEqual([mockLicense]);
    });
  });

  describe('revoke', () => {
    it('should revoke a license', async () => {
      repository.findById.mockResolvedValue(mockLicense);
      repository.revoke.mockResolvedValue({
        ...mockLicense,
        status: LicenseStatus.REVOKED,
        revokedAt: new Date(),
        revokedReason: 'Test reason',
      });

      const result = await service.revoke('test-id', 'Test reason');

      expect(repository.revoke).toHaveBeenCalledWith('test-id', 'Test reason');
      expect(result.status).toBe(LicenseStatus.REVOKED);
    });
  });

  describe('findAll', () => {
    it('should return paginated licenses', async () => {
      repository.findAll.mockResolvedValue([mockLicense]);

      const result = await service.findAll({ skip: 0, take: 10 });

      expect(repository.findAll).toHaveBeenCalledWith({ skip: 0, take: 10 });
      expect(result).toEqual([mockLicense]);
    });
  });

  describe('count', () => {
    it('should return license count', async () => {
      repository.count.mockResolvedValue(42);

      const result = await service.count();

      expect(result).toBe(42);
    });
  });

  describe('createFromWebhook', () => {
    it('should create license from webhook data', async () => {
      cryptoService.generateLicenseKey.mockReturnValue('BITBONSAI-PAT-payload.signature');
      repository.create.mockResolvedValue(mockLicense);

      const result = await service.createFromWebhook({
        email: 'test@example.com',
        tier: LicenseTier.PATREON_PRO,
        provider: PaymentProvider.PATREON,
        providerCustomerId: 'cust_123',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: PaymentProvider.PATREON,
          providerCustomerId: 'cust_123',
        })
      );
      expect(result).toEqual(mockLicense);
    });
  });

  describe('upgradeFromWebhook', () => {
    it('should upgrade existing license', async () => {
      repository.findByProviderCustomerId.mockResolvedValue(mockLicense);
      cryptoService.generateLicenseKey.mockReturnValue('BITBONSAI-PAT-new.signature');
      repository.update.mockResolvedValue({
        ...mockLicense,
        tier: LicenseTier.PATREON_ULTIMATE,
      });

      const result = await service.upgradeFromWebhook({
        provider: PaymentProvider.PATREON,
        providerCustomerId: 'cust_123',
        newTier: LicenseTier.PATREON_ULTIMATE,
      });

      expect(repository.update).toHaveBeenCalled();
      expect(result?.tier).toBe(LicenseTier.PATREON_ULTIMATE);
    });

    it('should return null if license not found', async () => {
      repository.findByProviderCustomerId.mockResolvedValue(null);

      const result = await service.upgradeFromWebhook({
        provider: PaymentProvider.PATREON,
        providerCustomerId: 'not-found',
        newTier: LicenseTier.PATREON_ULTIMATE,
      });

      expect(result).toBeNull();
    });
  });
});
