import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { CryptoService, LicensePayload } from '../crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;
  let tempKeysDir: string;

  beforeEach(async () => {
    tempKeysDir = path.join('/tmp', `license-keys-test-${Date.now()}`);

    const configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'LICENSE_KEYS_DIR') return tempKeysDir;
        return defaultValue;
      }),
    } as unknown as ConfigService;

    service = new CryptoService(configService);
    await service.onModuleInit();
  });

  afterEach(() => {
    if (fs.existsSync(tempKeysDir)) {
      fs.rmSync(tempKeysDir, { recursive: true });
    }
  });

  describe('generateLicenseKey', () => {
    it('should generate a license key with correct format', () => {
      const payload: LicensePayload = {
        email: 'test@example.com',
        tier: 'PATREON_PRO',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        expiresAt: null,
        issuedAt: new Date().toISOString(),
      };

      const key = service.generateLicenseKey(payload);

      expect(key).toMatch(/^BITBONSAI-PAT-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    it('should generate different keys for different payloads', () => {
      const payload1: LicensePayload = {
        email: 'user1@example.com',
        tier: 'FREE',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        expiresAt: null,
        issuedAt: new Date().toISOString(),
      };

      const payload2: LicensePayload = {
        email: 'user2@example.com',
        tier: 'FREE',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        expiresAt: null,
        issuedAt: new Date().toISOString(),
      };

      const key1 = service.generateLicenseKey(payload1);
      const key2 = service.generateLicenseKey(payload2);

      expect(key1).not.toBe(key2);
    });

    it('should use correct tier prefix', () => {
      const tiers = ['FREE', 'PATREON_SUPPORTER', 'COMMERCIAL_ENTERPRISE'];
      const prefixes = ['FRE', 'PAT', 'COM'];

      tiers.forEach((tier, index) => {
        const payload: LicensePayload = {
          email: 'test@example.com',
          tier,
          maxNodes: 1,
          maxConcurrentJobs: 2,
          expiresAt: null,
          issuedAt: new Date().toISOString(),
        };

        const key = service.generateLicenseKey(payload);
        expect(key).toContain(`BITBONSAI-${prefixes[index]}-`);
      });
    });
  });

  describe('verifyLicenseKey', () => {
    it('should verify a valid license key', () => {
      const payload: LicensePayload = {
        email: 'test@example.com',
        tier: 'PATREON_PRO',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        expiresAt: null,
        issuedAt: new Date().toISOString(),
      };

      const key = service.generateLicenseKey(payload);
      const result = service.verifyLicenseKey(key);

      expect(result).not.toBeNull();
      expect(result?.payload.email).toBe(payload.email);
      expect(result?.payload.tier).toBe(payload.tier);
      expect(result?.payload.maxNodes).toBe(payload.maxNodes);
    });

    it('should return null for invalid license key format', () => {
      expect(service.verifyLicenseKey('invalid-key')).toBeNull();
      expect(service.verifyLicenseKey('')).toBeNull();
      expect(service.verifyLicenseKey('BITBONSAI-')).toBeNull();
      expect(service.verifyLicenseKey('BITBONSAI-PRO')).toBeNull();
    });

    it('should return null for tampered license key', () => {
      const payload: LicensePayload = {
        email: 'test@example.com',
        tier: 'PATREON_PRO',
        maxNodes: 5,
        maxConcurrentJobs: 10,
        expiresAt: null,
        issuedAt: new Date().toISOString(),
      };

      const key = service.generateLicenseKey(payload);
      // Tamper with the base64url payload by changing a character
      const parts = key.split('.');
      const [_prefix, payloadPart] =
        parts[0].split('-').slice(0, 2).join('-').length > 0
          ? [
              key.substring(0, key.indexOf('-', key.indexOf('-') + 1) + 1),
              key.substring(key.indexOf('-', key.indexOf('-') + 1) + 1).split('.')[0],
            ]
          : ['', ''];

      // Simply change a character in the middle of the payload
      const tamperedPayload = `${payloadPart.substring(0, 10)}X${payloadPart.substring(11)}`;
      const tamperedKey = `BITBONSAI-PAT-${tamperedPayload}.${parts[1]}`;

      expect(service.verifyLicenseKey(tamperedKey)).toBeNull();
    });

    it('should return null for invalid signature', () => {
      const payload: LicensePayload = {
        email: 'test@example.com',
        tier: 'FREE',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        expiresAt: null,
        issuedAt: new Date().toISOString(),
      };

      const key = service.generateLicenseKey(payload);
      const parts = key.split('.');
      const badSignature = 'badsignature';
      const tamperedKey = `${parts[0]}.${badSignature}`;

      expect(service.verifyLicenseKey(tamperedKey)).toBeNull();
    });
  });

  describe('getPublicKeyPem', () => {
    it('should return a valid PEM-formatted public key', () => {
      const pem = service.getPublicKeyPem();

      expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
      expect(pem).toContain('-----END PUBLIC KEY-----');
    });
  });

  describe('key persistence', () => {
    it('should create keys directory if not exists', () => {
      expect(fs.existsSync(tempKeysDir)).toBe(true);
    });

    it('should save keys to files', () => {
      expect(fs.existsSync(path.join(tempKeysDir, 'private.pem'))).toBe(true);
      expect(fs.existsSync(path.join(tempKeysDir, 'public.pem'))).toBe(true);
    });

    it('should set correct permissions on private key', () => {
      const stats = fs.statSync(path.join(tempKeysDir, 'private.pem'));
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });
});
