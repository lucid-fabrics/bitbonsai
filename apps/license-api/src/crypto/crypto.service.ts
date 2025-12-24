import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface LicensePayload {
  email: string;
  tier: string;
  maxNodes: number;
  maxConcurrentJobs: number;
  expiresAt: string | null;
  issuedAt: string;
}

export interface SignedLicense {
  payload: LicensePayload;
  signature: string;
}

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private privateKey: crypto.KeyObject | null = null;
  private publicKey: crypto.KeyObject | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.loadOrGenerateKeys();
  }

  private async loadOrGenerateKeys(): Promise<void> {
    const keysDir = this.configService.get<string>('LICENSE_KEYS_DIR', './keys');
    const privateKeyPath = path.join(keysDir, 'private.pem');
    const publicKeyPath = path.join(keysDir, 'public.pem');

    if (!fs.existsSync(keysDir)) {
      fs.mkdirSync(keysDir, { recursive: true });
    }

    if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
      this.logger.log('Loading existing Ed25519 keypair');
      this.privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath));
      this.publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyPath));
    } else {
      this.logger.log('Generating new Ed25519 keypair');
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

      fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
        mode: 0o600,
      });
      fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }), {
        mode: 0o644,
      });

      this.privateKey = privateKey;
      this.publicKey = publicKey;
      this.logger.log('Keypair generated and saved');
    }
  }

  generateLicenseKey(payload: LicensePayload): string {
    if (!this.privateKey) {
      throw new Error('Private key not loaded');
    }

    const payloadJson = JSON.stringify(payload);
    const payloadBase64 = Buffer.from(payloadJson).toString('base64url');
    const signature = crypto.sign(null, Buffer.from(payloadJson), this.privateKey);
    const signatureBase64 = signature.toString('base64url');
    const tierPrefix = payload.tier.substring(0, 3).toUpperCase();

    return `BITBONSAI-${tierPrefix}-${payloadBase64}.${signatureBase64}`;
  }

  verifyLicenseKey(licenseKey: string): SignedLicense | null {
    if (!this.publicKey) {
      throw new Error('Public key not loaded');
    }

    try {
      if (!licenseKey.startsWith('BITBONSAI-')) {
        return null;
      }

      const firstHyphen = licenseKey.indexOf('-');
      const secondHyphen = licenseKey.indexOf('-', firstHyphen + 1);
      if (secondHyphen === -1) {
        return null;
      }

      const payloadAndSignature = licenseKey.substring(secondHyphen + 1);
      const lastDotIndex = payloadAndSignature.lastIndexOf('.');
      if (lastDotIndex === -1) {
        return null;
      }

      const payloadBase64 = payloadAndSignature.substring(0, lastDotIndex);
      const signatureBase64 = payloadAndSignature.substring(lastDotIndex + 1);

      if (!payloadBase64 || !signatureBase64) {
        return null;
      }

      const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
      const signature = Buffer.from(signatureBase64, 'base64url');

      const isValid = crypto.verify(null, Buffer.from(payloadJson), this.publicKey, signature);
      if (!isValid) {
        return null;
      }

      const payload = JSON.parse(payloadJson) as LicensePayload;
      return { payload, signature: signatureBase64 };
    } catch {
      return null;
    }
  }

  getPublicKeyPem(): string {
    if (!this.publicKey) {
      throw new Error('Public key not loaded');
    }
    return this.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }
}
