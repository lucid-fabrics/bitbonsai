import { HttpService } from '@nestjs/axios';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudAuthService } from '../cloud-auth.service';

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

describe('CloudAuthService', () => {
  let service: CloudAuthService;

  const mockPrisma = {
    settings: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockHttpService = {
    post: jest.fn(),
    delete: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultVal?: string) => {
      const map: Record<string, string> = {
        LICENSING_SERVICE_URL: 'https://api.bitbonsai.app',
        LICENSING_PRODUCT_ID: 'bitbonsai',
      };
      return map[key] ?? defaultVal;
    }),
    getOrThrow: jest.fn(() => 'test-admin-api-key'),
  };

  const baseSettings = {
    id: 'settings-1',
    machineId: 'machine-abc',
    cloudDeviceToken: null,
    cloudUserEmail: null,
    cloudTier: null,
    cloudMaxNodes: null,
    cloudMaxConcurrentJobs: null,
    cloudValidatedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudAuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CloudAuthService>(CloudAuthService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── ensureMachineId ────────────────────────────────────────────────────────

  describe('ensureMachineId', () => {
    it('returns empty string when settings is null', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(null);

      const result = await service.ensureMachineId();

      expect(result).toBe('');
      expect(mockPrisma.settings.update).not.toHaveBeenCalled();
    });

    it('returns existing machineId when settings already has one', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue({
        ...baseSettings,
        machineId: 'existing-id',
      });

      const result = await service.ensureMachineId();

      expect(result).toBe('existing-id');
      expect(mockPrisma.settings.update).not.toHaveBeenCalled();
    });

    it('generates and saves a UUID when machineId is missing', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue({ ...baseSettings, machineId: null });
      mockPrisma.settings.update.mockResolvedValue({ ...baseSettings });

      const result = await service.ensureMachineId();

      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(mockPrisma.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { machineId: result },
      });
    });
  });

  // ─── startDeviceFlow ────────────────────────────────────────────────────────

  describe('startDeviceFlow', () => {
    const deviceFlowResponse = {
      userCode: 'ABCD-1234',
      verificationUri: 'https://bitbonsai.app/activate',
      verificationUriComplete: 'https://bitbonsai.app/activate?code=ABCD-1234',
      expiresIn: 900,
      interval: 5,
      deviceCode: 'device-code-xyz',
    };

    beforeEach(() => {
      mockPrisma.settings.findFirst.mockResolvedValue(baseSettings);
      mockHttpService.post.mockReturnValue(of({ data: deviceFlowResponse }));
    });

    it('calls /device/code with correct headers and body', async () => {
      await service.startDeviceFlow('My Mac');

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://api.bitbonsai.app/device/code',
        { productId: 'bitbonsai', machineId: 'machine-abc', machineName: 'My Mac' },
        { headers: { 'x-admin-api-key': 'test-admin-api-key' } }
      );
    });

    it('returns the response data from the licensing service', async () => {
      const result = await service.startDeviceFlow('My Mac');

      expect(result).toEqual(deviceFlowResponse);
    });

    it('starts background polling without awaiting', async () => {
      // pollForToken is called in background; stub it to avoid real timers
      const pollSpy = jest.spyOn(service, 'pollForToken').mockResolvedValue(undefined);

      await service.startDeviceFlow('My Mac');

      expect(pollSpy).toHaveBeenCalledWith('device-code-xyz');
    });

    it('works without machineName', async () => {
      await expect(service.startDeviceFlow()).resolves.toEqual(deviceFlowResponse);
    });
  });

  // ─── pollForToken ───────────────────────────────────────────────────────────

  describe('pollForToken', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('continues looping on authorization_pending then succeeds', async () => {
      const entitlements = {
        tier: 'SUPPORTER',
        maxNodes: 3,
        maxConcurrentJobs: 6,
        subscriptionStatus: 'active',
        currentPeriodEnd: '2026-12-01',
        email: 'user@example.com',
      };

      mockHttpService.post
        .mockReturnValueOnce(of({ data: { error: 'authorization_pending' } }))
        .mockReturnValueOnce(of({ data: { deviceToken: 'tok-abc', entitlements } }));

      mockPrisma.settings.findFirst.mockResolvedValue(baseSettings);
      mockPrisma.settings.update.mockResolvedValue(baseSettings);

      const pollPromise = service.pollForToken('device-code-xyz');
      // Advance past first interval
      await jest.advanceTimersByTimeAsync(5000);
      // Advance past second interval
      await jest.advanceTimersByTimeAsync(5000);
      await pollPromise;

      expect(mockPrisma.settings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cloudDeviceToken: 'tok-abc', cloudTier: 'SUPPORTER' }),
        })
      );
    });

    it('returns early and logs warn when error is "expired"', async () => {
      mockHttpService.post.mockReturnValue(of({ data: { error: 'expired' } }));

      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      const pollPromise = service.pollForToken('device-code-xyz');
      await jest.advanceTimersByTimeAsync(5000);
      await pollPromise;

      expect(warnSpy).toHaveBeenCalledWith('Device flow request expired before user authorized');
    });

    it('catches HTTP errors and continues polling', async () => {
      const entitlements = {
        tier: 'FREE',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        subscriptionStatus: 'active',
        currentPeriodEnd: null,
        email: null,
      };

      mockHttpService.post
        .mockReturnValueOnce(throwError(() => new Error('network error')))
        .mockReturnValueOnce(of({ data: { deviceToken: 'tok-xyz', entitlements } }));

      mockPrisma.settings.findFirst.mockResolvedValue(baseSettings);
      mockPrisma.settings.update.mockResolvedValue(baseSettings);

      const pollPromise = service.pollForToken('device-code-xyz');
      await jest.advanceTimersByTimeAsync(5000);
      await jest.advanceTimersByTimeAsync(5000);
      await pollPromise;

      expect(mockPrisma.settings.update).toHaveBeenCalled();
    });

    it('logs timeout warning when deadline is exceeded without token', async () => {
      mockHttpService.post.mockReturnValue(of({ data: { error: 'authorization_pending' } }));

      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      const pollPromise = service.pollForToken('device-code-xyz');
      // Advance past the 10-minute deadline
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000 + 5000);
      await pollPromise;

      expect(warnSpy).toHaveBeenCalledWith('Device flow timed out');
    });
  });

  // ─── storeToken ─────────────────────────────────────────────────────────────

  describe('storeToken', () => {
    const validEntitlements = {
      tier: 'SUPPORTER',
      maxNodes: 3,
      maxConcurrentJobs: 6,
      subscriptionStatus: 'active',
      currentPeriodEnd: '2026-12-01',
      email: 'user@example.com',
    };

    it('throws when entitlements is missing tier', async () => {
      const invalid = { ...validEntitlements, tier: undefined } as any;

      await expect(service.storeToken('tok', invalid)).rejects.toThrow(
        'Invalid entitlements payload'
      );
    });

    it('throws when entitlements is missing maxNodes', async () => {
      const invalid = { ...validEntitlements, maxNodes: undefined } as any;

      await expect(service.storeToken('tok', invalid)).rejects.toThrow(
        'Invalid entitlements payload'
      );
    });

    it('throws when entitlements is missing maxConcurrentJobs', async () => {
      const invalid = { ...validEntitlements, maxConcurrentJobs: undefined } as any;

      await expect(service.storeToken('tok', invalid)).rejects.toThrow(
        'Invalid entitlements payload'
      );
    });

    it('returns early without saving when settings is null', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(null);

      await expect(service.storeToken('tok', validEntitlements)).resolves.toBeUndefined();
      expect(mockPrisma.settings.update).not.toHaveBeenCalled();
    });

    it('saves all fields to settings on valid payload', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(baseSettings);
      mockPrisma.settings.update.mockResolvedValue(baseSettings);

      await service.storeToken('tok-abc', validEntitlements);

      expect(mockPrisma.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: {
          cloudDeviceToken: 'tok-abc',
          cloudUserEmail: 'user@example.com',
          cloudTier: 'SUPPORTER',
          cloudMaxNodes: 3,
          cloudMaxConcurrentJobs: 6,
          cloudValidatedAt: expect.any(Date),
        },
      });
    });

    it('stores null for email when entitlements.email is falsy', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(baseSettings);
      mockPrisma.settings.update.mockResolvedValue(baseSettings);

      await service.storeToken('tok-abc', { ...validEntitlements, email: '' });

      expect(mockPrisma.settings.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ cloudUserEmail: null }) })
      );
    });
  });

  // ─── validateNow ────────────────────────────────────────────────────────────

  describe('validateNow', () => {
    const settingsWithToken = {
      ...baseSettings,
      cloudDeviceToken: 'tok-abc',
      machineId: 'machine-abc',
    };

    const validEntitlementsResponse = {
      tier: 'SUPPORTER',
      maxNodes: 3,
      maxConcurrentJobs: 6,
      subscriptionStatus: 'active',
      currentPeriodEnd: '2026-12-01',
      email: 'user@example.com',
    };

    it('returns false when settings has no cloudDeviceToken', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(baseSettings);

      const result = await service.validateNow();

      expect(result).toBe(false);
    });

    it('returns false when settings has no machineId', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue({
        ...baseSettings,
        cloudDeviceToken: 'tok-abc',
        machineId: null,
      });

      const result = await service.validateNow();

      expect(result).toBe(false);
    });

    it('returns false when settings is null', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(null);

      const result = await service.validateNow();

      expect(result).toBe(false);
    });

    it('returns false when HTTP call fails', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(settingsWithToken);
      mockHttpService.post.mockReturnValue(throwError(() => new Error('Connection refused')));

      const result = await service.validateNow();

      expect(result).toBe(false);
    });

    it('returns false when entitlements response is invalid', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(settingsWithToken);
      mockHttpService.post.mockReturnValue(
        of({ data: { tier: null, maxNodes: null, maxConcurrentJobs: null } })
      );

      const result = await service.validateNow();

      expect(result).toBe(false);
    });

    it('saves updated fields and returns true on success', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(settingsWithToken);
      mockHttpService.post.mockReturnValue(of({ data: validEntitlementsResponse }));
      mockPrisma.settings.update.mockResolvedValue(settingsWithToken);

      const result = await service.validateNow();

      expect(result).toBe(true);
      expect(mockPrisma.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: {
          cloudUserEmail: 'user@example.com',
          cloudTier: 'SUPPORTER',
          cloudMaxNodes: 3,
          cloudMaxConcurrentJobs: 6,
          cloudValidatedAt: expect.any(Date),
        },
      });
    });

    it('calls /device/entitlements with correct headers', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(settingsWithToken);
      mockHttpService.post.mockReturnValue(of({ data: validEntitlementsResponse }));
      mockPrisma.settings.update.mockResolvedValue(settingsWithToken);

      await service.validateNow();

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://api.bitbonsai.app/device/entitlements',
        {},
        {
          headers: {
            'x-admin-api-key': 'test-admin-api-key',
            'x-device-token': 'tok-abc',
            'x-machine-id': 'machine-abc',
            'x-product-id': 'bitbonsai',
          },
        }
      );
    });
  });

  // ─── getStatus ──────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns linked=false and all nulls when no settings', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(null);

      const result = await service.getStatus();

      expect(result).toEqual({
        linked: false,
        email: null,
        tier: null,
        maxNodes: null,
        maxConcurrentJobs: null,
        validatedAt: null,
        gracePeriodExpiresAt: null,
        gracePeriodExpired: false,
      });
    });

    it('returns linked=false when cloudDeviceToken is null', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(baseSettings);

      const result = await service.getStatus();

      expect(result.linked).toBe(false);
    });

    it('returns linked=true when cloudDeviceToken is set', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue({
        ...baseSettings,
        cloudDeviceToken: 'tok-abc',
        cloudTier: 'SUPPORTER',
        cloudUserEmail: 'user@example.com',
        cloudMaxNodes: 3,
        cloudMaxConcurrentJobs: 6,
        cloudValidatedAt: new Date('2026-05-01T00:00:00Z'),
      });

      const result = await service.getStatus();

      expect(result.linked).toBe(true);
      expect(result.tier).toBe('SUPPORTER');
      expect(result.email).toBe('user@example.com');
      expect(result.maxNodes).toBe(3);
      expect(result.maxConcurrentJobs).toBe(6);
    });

    it('computes gracePeriodExpiresAt as validatedAt + 7 days', async () => {
      const validatedAt = new Date('2026-05-01T00:00:00Z');
      mockPrisma.settings.findFirst.mockResolvedValue({
        ...baseSettings,
        cloudDeviceToken: 'tok-abc',
        cloudValidatedAt: validatedAt,
      });

      const result = await service.getStatus();

      const expectedExpiry = new Date(validatedAt.getTime() + GRACE_PERIOD_MS);
      expect(result.gracePeriodExpiresAt).toEqual(expectedExpiry);
    });

    it('sets gracePeriodExpired=true when grace period has passed', async () => {
      const oldDate = new Date(Date.now() - GRACE_PERIOD_MS - 1000);
      mockPrisma.settings.findFirst.mockResolvedValue({
        ...baseSettings,
        cloudDeviceToken: 'tok-abc',
        cloudValidatedAt: oldDate,
      });

      const result = await service.getStatus();

      expect(result.gracePeriodExpired).toBe(true);
    });

    it('sets gracePeriodExpired=false when within grace period', async () => {
      const recentDate = new Date(Date.now() - 1000);
      mockPrisma.settings.findFirst.mockResolvedValue({
        ...baseSettings,
        cloudDeviceToken: 'tok-abc',
        cloudValidatedAt: recentDate,
      });

      const result = await service.getStatus();

      expect(result.gracePeriodExpired).toBe(false);
    });
  });

  // ─── getEntitlements ────────────────────────────────────────────────────────

  describe('getEntitlements', () => {
    it('throws ForbiddenException with CLOUD_AUTH_GRACE_EXPIRED when grace period expired', async () => {
      const oldDate = new Date(Date.now() - GRACE_PERIOD_MS - 1000);
      mockPrisma.settings.findFirst.mockResolvedValue({
        ...baseSettings,
        cloudDeviceToken: 'tok-abc',
        cloudValidatedAt: oldDate,
      });

      await expect(service.getEntitlements()).rejects.toThrow(ForbiddenException);

      try {
        await service.getEntitlements();
      } catch (err: any) {
        expect(err.response.error).toBe('CLOUD_AUTH_GRACE_EXPIRED');
        expect(err.response.upgradeUrl).toBe('/settings?tab=account');
      }
    });

    it('returns FREE/1/2 defaults when not linked', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(baseSettings);

      const result = await service.getEntitlements();

      expect(result).toEqual({ tier: 'FREE', maxNodes: 1, maxConcurrentJobs: 2 });
    });

    it('returns cached values when linked and within grace period', async () => {
      const recentDate = new Date(Date.now() - 1000);
      mockPrisma.settings.findFirst.mockResolvedValue({
        ...baseSettings,
        cloudDeviceToken: 'tok-abc',
        cloudTier: 'SUPPORTER',
        cloudMaxNodes: 5,
        cloudMaxConcurrentJobs: 10,
        cloudValidatedAt: recentDate,
      });

      const result = await service.getEntitlements();

      expect(result).toEqual({ tier: 'SUPPORTER', maxNodes: 5, maxConcurrentJobs: 10 });
    });
  });

  // ─── logout ─────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('returns early without updating when settings is null', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(null);

      await service.logout();

      expect(mockPrisma.settings.update).not.toHaveBeenCalled();
    });

    it('skips revoke call when settings has no cloudDeviceToken', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(baseSettings);
      mockPrisma.settings.update.mockResolvedValue(baseSettings);

      await service.logout();

      expect(mockHttpService.delete).not.toHaveBeenCalled();
      expect(mockPrisma.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: {
          cloudDeviceToken: null,
          cloudUserEmail: null,
          cloudTier: null,
          cloudMaxNodes: null,
          cloudMaxConcurrentJobs: null,
          cloudValidatedAt: null,
        },
      });
    });

    it('calls DELETE on licensing-service when token is present', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue({
        ...baseSettings,
        cloudDeviceToken: 'tok-abc',
      });
      mockHttpService.delete.mockReturnValue(of({ data: {} }));
      mockPrisma.settings.update.mockResolvedValue(baseSettings);

      await service.logout();

      expect(mockHttpService.delete).toHaveBeenCalledWith(
        'https://api.bitbonsai.app/device/token',
        {
          headers: {
            'x-admin-api-key': 'test-admin-api-key',
            'x-device-token': 'tok-abc',
          },
        }
      );
    });

    it('still clears settings even when revoke call fails', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue({
        ...baseSettings,
        cloudDeviceToken: 'tok-abc',
      });
      mockHttpService.delete.mockReturnValue(throwError(() => new Error('Revoke failed')));
      mockPrisma.settings.update.mockResolvedValue(baseSettings);

      await expect(service.logout()).resolves.toBeUndefined();

      expect(mockPrisma.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: {
          cloudDeviceToken: null,
          cloudUserEmail: null,
          cloudTier: null,
          cloudMaxNodes: null,
          cloudMaxConcurrentJobs: null,
          cloudValidatedAt: null,
        },
      });
    });

    it('clears all cloud fields after successful revoke', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue({
        ...baseSettings,
        cloudDeviceToken: 'tok-abc',
        cloudTier: 'SUPPORTER',
        cloudUserEmail: 'user@example.com',
        cloudMaxNodes: 3,
        cloudMaxConcurrentJobs: 6,
        cloudValidatedAt: new Date(),
      });
      mockHttpService.delete.mockReturnValue(of({ data: {} }));
      mockPrisma.settings.update.mockResolvedValue(baseSettings);

      await service.logout();

      expect(mockPrisma.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: {
          cloudDeviceToken: null,
          cloudUserEmail: null,
          cloudTier: null,
          cloudMaxNodes: null,
          cloudMaxConcurrentJobs: null,
          cloudValidatedAt: null,
        },
      });
    });
  });
});
