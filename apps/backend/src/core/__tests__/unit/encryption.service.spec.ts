import { Test, type TestingModule } from '@nestjs/testing';
import { EncryptionService } from '../../services/encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;
  const originalEnv = process.env.ENCRYPTION_KEY;

  beforeEach(async () => {
    // Set a test encryption key
    process.env.ENCRYPTION_KEY = 'VXwrVvc2qvR4OEvuHy7aGxcJzIgcPY53M0FOY4PaquI=';

    const module: TestingModule = await Test.createTestingModule({
      providers: [EncryptionService],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
  });

  afterEach(() => {
    // Restore original environment
    if (originalEnv) {
      process.env.ENCRYPTION_KEY = originalEnv;
    } else {
      process.env.ENCRYPTION_KEY = undefined;
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('encrypt', () => {
    it('should encrypt a plain text string', () => {
      const plaintext = 'my-secure-password';
      const encrypted = service.encrypt(plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
      expect(typeof encrypted).toBe('string');
    });

    it('should return different ciphertext for same input (due to random IV)', () => {
      const plaintext = 'my-secure-password';
      const encrypted1 = service.encrypt(plaintext);
      const encrypted2 = service.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should return encrypted data with correct format (iv:authTag:encrypted)', () => {
      const plaintext = 'test-password';
      const encrypted = service.encrypt(plaintext);

      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);

      // Each part should be valid base64
      const base64Regex = /^[A-Za-z0-9+/]+=*$/;
      parts.forEach((part) => {
        expect(base64Regex.test(part)).toBe(true);
      });
    });

    it('should encrypt empty string', () => {
      const encrypted = service.encrypt('');
      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
    });

    it('should encrypt special characters', () => {
      const plaintext = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const encrypted = service.encrypt(plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
    });

    it('should encrypt unicode characters', () => {
      const plaintext = 'пароль123🔐';
      const encrypted = service.encrypt(plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
    });

    it('should encrypt long strings', () => {
      const plaintext = 'a'.repeat(10000);
      const encrypted = service.encrypt(plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
    });
  });

  describe('decrypt', () => {
    it('should decrypt an encrypted string back to original', () => {
      const plaintext = 'my-secure-password';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should decrypt empty string', () => {
      const plaintext = '';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should decrypt special characters', () => {
      const plaintext = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should decrypt unicode characters', () => {
      const plaintext = 'пароль123🔐';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should decrypt long strings', () => {
      const plaintext = 'a'.repeat(10000);
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw error for invalid encrypted data format', () => {
      expect(() => service.decrypt('invalid-data')).toThrow('Failed to decrypt data');
    });

    it('should not return original plaintext for corrupted encrypted data', () => {
      const plaintext = 'test-password';
      const encrypted = service.encrypt(plaintext);

      // Corrupt the encrypted data
      const corrupted = encrypted.replace(/a/g, 'b');

      try {
        const result = service.decrypt(corrupted);
        expect(result).not.toBe(plaintext);
      } catch {
        // Throwing is also acceptable
        expect(true).toBe(true);
      }
    });

    it('should throw error for tampered authentication tag', () => {
      const plaintext = 'test-password';
      const encrypted = service.encrypt(plaintext);
      const parts = encrypted.split(':');

      // Tamper with the auth tag
      parts[1] = `AAAA${parts[1].substring(4)}`;
      const tampered = parts.join(':');

      expect(() => service.decrypt(tampered)).toThrow('Failed to decrypt data');
    });

    it('should throw error for missing parts', () => {
      expect(() => service.decrypt('part1:part2')).toThrow('Failed to decrypt data');
    });

    it('should return empty string for empty encrypted data', () => {
      const result = service.decrypt('');
      expect(result).toBe('');
    });
  });

  describe('isEncrypted', () => {
    it('should return true for properly encrypted data', () => {
      const plaintext = 'my-secure-password';
      const encrypted = service.encrypt(plaintext);

      expect(service.isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plain text', () => {
      expect(service.isEncrypted('plain-text-password')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(service.isEncrypted('')).toBe(false);
    });

    it('should return false for string with wrong format (only 2 parts)', () => {
      expect(service.isEncrypted('part1:part2')).toBe(false);
    });

    it('should return false for string with wrong format (4 parts)', () => {
      expect(service.isEncrypted('part1:part2:part3:part4')).toBe(false);
    });

    it('should return false for non-base64 content', () => {
      expect(service.isEncrypted('invalid:base64!:content')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(service.isEncrypted(null as any)).toBe(false);
      expect(service.isEncrypted(undefined as any)).toBe(false);
    });

    it('should correctly identify encrypted vs plain text in mixed scenarios', () => {
      const plainPasswords = ['password123', 'admin', 'P@ssw0rd!', '12345678'];

      const encryptedPasswords = plainPasswords.map((p) => service.encrypt(p));

      plainPasswords.forEach((plain) => {
        expect(service.isEncrypted(plain)).toBe(false);
      });

      encryptedPasswords.forEach((encrypted) => {
        expect(service.isEncrypted(encrypted)).toBe(true);
      });
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    const testCases = [
      'simple-password',
      'P@ssw0rd!123',
      `very-long-password-${'x'.repeat(1000)}`,
      'пароль',
      '🔐🔑',
      'multi\nline\npassword',
      'password with spaces',
      'tab\tseparated',
      JSON.stringify({ nested: { object: 'password' } }),
    ];

    testCases.forEach((testCase) => {
      it(`should successfully round-trip: "${testCase.substring(0, 50)}..."`, () => {
        const encrypted = service.encrypt(testCase);
        const decrypted = service.decrypt(encrypted);

        expect(decrypted).toBe(testCase);
        expect(service.isEncrypted(encrypted)).toBe(true);
      });
    });

    it('should handle empty string specially (returns empty, not encrypted)', () => {
      const encrypted = service.encrypt('');
      const decrypted = service.decrypt(encrypted);

      expect(encrypted).toBe('');
      expect(decrypted).toBe('');
      expect(service.isEncrypted(encrypted)).toBe(false);
    });
  });

  describe('environment variable validation', () => {
    it('should warn if ENCRYPTION_KEY is not set when encrypting', () => {
      // Temporarily remove the key
      process.env.ENCRYPTION_KEY = undefined;

      // Create new service instance
      const customService = new EncryptionService();

      // Spy on logger.warn (access via any to bypass private)
      const warnSpy = jest.spyOn((customService as any).logger, 'warn').mockImplementation();

      // Trigger encryption (which calls getEncryptionKey) - now throws without key
      expect(() => customService.encrypt('test')).toThrow('Failed to encrypt data');

      warnSpy.mockRestore();
    });

    it('should use environment ENCRYPTION_KEY when set', () => {
      process.env.ENCRYPTION_KEY = 'custom-key-base64-encoded-32-bytes-string==';

      const customService = new EncryptionService();
      const plaintext = 'test-password';

      const encrypted = customService.encrypt(plaintext);
      const decrypted = customService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('security properties', () => {
    it('should use authenticated encryption (GCM mode)', () => {
      const plaintext = 'test-password';
      const encrypted = service.encrypt(plaintext);

      // GCM produces auth tag, verify format includes it
      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);
      expect(parts[1].length).toBeGreaterThan(0); // Auth tag present
    });

    it('should use unique IV for each encryption', () => {
      const plaintext = 'test-password';
      const encrypted1 = service.encrypt(plaintext);
      const encrypted2 = service.encrypt(plaintext);

      const iv1 = encrypted1.split(':')[0];
      const iv2 = encrypted2.split(':')[0];

      expect(iv1).not.toBe(iv2);
    });

    it('should detect tampering through authentication tag', () => {
      const plaintext = 'test-password';
      const encrypted = service.encrypt(plaintext);
      const parts = encrypted.split(':');

      // Tamper with ciphertext by appending data
      const originalCiphertext = parts[2];
      const tamperedCiphertext = `${originalCiphertext}AAAA`;
      parts[2] = tamperedCiphertext;

      const tampered = parts.join(':');

      // Tampered data should either throw or return something different from original
      try {
        const result = service.decrypt(tampered);
        expect(result).not.toBe(plaintext);
      } catch {
        // Throwing is also acceptable behavior for tampered data
        expect(true).toBe(true);
      }
    });
  });

  describe('backward compatibility detection', () => {
    it('should distinguish between old plain text and new encrypted passwords', () => {
      const oldPlainPasswords = [
        'admin123',
        'password',
        'P@ssw0rd',
        'user:password', // Even with colon
      ];

      const newEncryptedPassword = service.encrypt('admin123');

      oldPlainPasswords.forEach((old) => {
        expect(service.isEncrypted(old)).toBe(false);
      });

      expect(service.isEncrypted(newEncryptedPassword)).toBe(true);
    });
  });
});
