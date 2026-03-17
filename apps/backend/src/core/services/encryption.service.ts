import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Service for encrypting and decrypting sensitive data
 * Uses AES-256-GCM for authenticated encryption
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 16; // 128 bits

  /**
   * Derives encryption key from environment variable
   * SECURITY: ENCRYPTION_KEY is required - no default fallback
   */
  private getEncryptionKey(): Buffer {
    const secret = process.env.ENCRYPTION_KEY;

    if (!secret) {
      throw new Error(
        '⚠️  ENCRYPTION_KEY environment variable is required! ' +
          'Generate with: openssl rand -base64 32'
      );
    }

    if (secret.length < 32) {
      throw new Error('ENCRYPTION_KEY must be at least 32 characters');
    }

    // Use scrypt to derive a key from the secret
    const salt = Buffer.from('bitbonsai-salt-v1'); // Fixed salt for key derivation
    return scryptSync(secret, salt, this.keyLength);
  }

  /**
   * Encrypts a string value using AES-256-GCM
   * Returns base64-encoded string: salt:iv:authTag:encryptedData
   *
   * @param plaintext - The string to encrypt
   * @returns Encrypted string in format: salt:iv:authTag:encryptedData (base64)
   */
  encrypt(plaintext: string): string {
    if (!plaintext) {
      return '';
    }

    try {
      // Generate random IV (initialization vector)
      const iv = randomBytes(this.ivLength);

      // Get encryption key
      const key = this.getEncryptionKey();

      // Create cipher
      const cipher = createCipheriv(this.algorithm, key, iv);

      // Encrypt the data
      let encrypted = cipher.update(plaintext, 'utf8', 'base64');
      encrypted += cipher.final('base64');

      // Get auth tag for GCM mode
      const authTag = cipher.getAuthTag();

      // Combine IV, auth tag, and encrypted data
      // Format: iv:authTag:encryptedData (all base64)
      const result = `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;

      return result;
    } catch (error) {
      this.logger.error('Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypts a string value encrypted with AES-256-GCM
   *
   * @param encryptedData - Encrypted string in format: iv:authTag:encryptedData (base64)
   * @returns Decrypted plaintext string
   */
  decrypt(encryptedData: string): string {
    if (!encryptedData) {
      return '';
    }

    try {
      // Split the encrypted data into components
      const parts = encryptedData.split(':');

      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }

      const iv = Buffer.from(parts[0], 'base64');
      const authTag = Buffer.from(parts[1], 'base64');
      const encrypted = parts[2];

      // Get encryption key
      const key = this.getEncryptionKey();

      // Create decipher
      const decipher = createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);

      // Decrypt the data
      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      this.logger.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Check if a string appears to be encrypted (contains our format)
   */
  isEncrypted(value: string): boolean {
    if (!value) {
      return false;
    }

    // Check if format matches: base64:base64:base64
    const parts = value.split(':');
    if (parts.length !== 3) {
      return false;
    }

    // Simple check: all parts should be base64-like
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    return parts.every((part) => base64Regex.test(part));
  }
}
