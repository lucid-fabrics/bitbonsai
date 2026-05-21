import { Test, type TestingModule } from '@nestjs/testing';
import { EncryptionService } from '../../encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;

  // Store original env var
  const originalEnv = process.env.ENCRYPTION_KEY;

  beforeEach(async () => {
    // Set a valid encryption key for tests
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';

    const module: TestingModule = await Test.createTestingModule({
      providers: [EncryptionService],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      process.env.ENCRYPTION_KEY = '';
    } else {
      process.env.ENCRYPTION_KEY = originalEnv;
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('encrypt', () => {
    it('should encrypt a string and return base64 format', () => {
      const plaintext = 'Hello, World!';
      const encrypted = service.encrypt(plaintext);

      expect(encrypted).not.toEqual(plaintext);
      expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
    });

    it('should return empty string for empty input', () => {
      const encrypted = service.encrypt('');
      expect(encrypted).toBe('');
    });

    it('should produce different ciphertext for same plaintext (due to random IV)', () => {
      const plaintext = 'Hello, World!';
      const encrypted1 = service.encrypt(plaintext);
      const encrypted2 = service.encrypt(plaintext);

      expect(encrypted1).not.toEqual(encrypted2);
    });

    it('should handle special characters', () => {
      const plaintext = 'Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toEqual(plaintext);
    });

    it('should handle Unicode characters', () => {
      const plaintext = 'Unicode: مرحبا 中文 🎉';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toEqual(plaintext);
    });

    it('should handle long strings', () => {
      const plaintext = 'A'.repeat(10000);
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('decrypt', () => {
    it('should decrypt encrypted string back to original', () => {
      const plaintext = 'Hello, World!';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it('should return empty string for empty input', () => {
      const decrypted = service.decrypt('');
      expect(decrypted).toBe('');
    });

    it('should throw error for invalid format', () => {
      expect(() => service.decrypt('invalid-format')).toThrow('Failed to decrypt data');
    });

    it('should throw error for wrong encryption key', () => {
      const plaintext = 'Secret message';
      const encrypted = service.encrypt(plaintext);

      // Change the key
      process.env.ENCRYPTION_KEY = 'different-key-32-characters-long!';

      expect(() => service.decrypt(encrypted)).toThrow('Failed to decrypt data');
    });

    it('should handle all base64 characters', () => {
      const plaintext = 'Base64: ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('isEncrypted', () => {
    it('should return true for encrypted values', () => {
      const encrypted = service.encrypt('test');
      expect(service.isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for non-encrypted values', () => {
      expect(service.isEncrypted('plain text')).toBe(false);
      expect(service.isEncrypted('not-base64:invalid')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(service.isEncrypted('')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(service.isEncrypted(null as unknown as string)).toBe(false);
      expect(service.isEncrypted(undefined as unknown as string)).toBe(false);
    });

    it('should return false for non-matching format', () => {
      expect(service.isEncrypted('a:b')).toBe(false);
      expect(service.isEncrypted('a:b:c:d')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw error when ENCRYPTION_KEY is not set', () => {
      process.env.ENCRYPTION_KEY = '';

      const newService = new EncryptionService();
      expect(() => newService.encrypt('test')).toThrow('Failed to encrypt data');
    });

    it('should throw error when ENCRYPTION_KEY is too short', () => {
      process.env.ENCRYPTION_KEY = 'short';

      const newService = new EncryptionService();
      expect(() => newService.encrypt('test')).toThrow('Failed to encrypt data');
    });
  });
});
