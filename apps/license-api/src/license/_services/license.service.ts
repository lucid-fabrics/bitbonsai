import { License, LicenseStatus, LicenseTier, PaymentProvider } from '.prisma/license-client';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CryptoService, LicensePayload } from '../../crypto/crypto.service';
import { CreateLicenseDto, VerifyLicenseDto } from '../_dtos';
import { LicenseRepository } from '../_repositories/license.repository';

const TIER_LIMITS: Record<LicenseTier, { maxNodes: number; maxConcurrentJobs: number }> = {
  FREE: { maxNodes: 1, maxConcurrentJobs: 2 },
  PATREON_SUPPORTER: { maxNodes: 2, maxConcurrentJobs: 3 },
  PATREON_PLUS: { maxNodes: 3, maxConcurrentJobs: 5 },
  PATREON_PRO: { maxNodes: 5, maxConcurrentJobs: 10 },
  PATREON_ULTIMATE: { maxNodes: 10, maxConcurrentJobs: 20 },
  COMMERCIAL_STARTER: { maxNodes: 15, maxConcurrentJobs: 30 },
  COMMERCIAL_PRO: { maxNodes: 50, maxConcurrentJobs: 100 },
  COMMERCIAL_ENTERPRISE: { maxNodes: 999, maxConcurrentJobs: 999 },
};

@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name);

  constructor(
    private readonly licenseRepository: LicenseRepository,
    private readonly cryptoService: CryptoService
  ) {}

  async create(dto: CreateLicenseDto): Promise<License> {
    const tier = dto.tier as unknown as LicenseTier;
    const limits = TIER_LIMITS[tier];

    const payload: LicensePayload = {
      email: dto.email,
      tier: dto.tier,
      maxNodes: dto.maxNodes ?? limits.maxNodes,
      maxConcurrentJobs: dto.maxConcurrentJobs ?? limits.maxConcurrentJobs,
      expiresAt: dto.expiresAt ?? null,
      issuedAt: new Date().toISOString(),
    };

    const licenseKey = this.cryptoService.generateLicenseKey(payload);
    const license = await this.licenseRepository.create({
      key: licenseKey,
      email: dto.email,
      tier,
      maxNodes: payload.maxNodes,
      maxConcurrentJobs: payload.maxConcurrentJobs,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });

    this.logger.log(`Created license ${license.id} for ${dto.email} (${dto.tier})`);
    return license;
  }

  async createFromWebhook(params: {
    email: string;
    tier: LicenseTier;
    provider: PaymentProvider;
    providerCustomerId: string;
    expiresAt?: Date;
  }): Promise<License> {
    const limits = TIER_LIMITS[params.tier];
    const payload: LicensePayload = {
      email: params.email,
      tier: params.tier,
      maxNodes: limits.maxNodes,
      maxConcurrentJobs: limits.maxConcurrentJobs,
      expiresAt: params.expiresAt?.toISOString() ?? null,
      issuedAt: new Date().toISOString(),
    };

    const licenseKey = this.cryptoService.generateLicenseKey(payload);
    return this.licenseRepository.create({
      key: licenseKey,
      email: params.email,
      tier: params.tier,
      maxNodes: limits.maxNodes,
      maxConcurrentJobs: limits.maxConcurrentJobs,
      expiresAt: params.expiresAt,
      provider: params.provider,
      providerCustomerId: params.providerCustomerId,
      providerEmail: params.email,
    });
  }

  async verify(
    dto: VerifyLicenseDto
  ): Promise<{ valid: boolean; license?: LicensePayload; error?: string }> {
    const result = this.cryptoService.verifyLicenseKey(dto.licenseKey);
    if (!result) return { valid: false, error: 'Invalid license key signature' };

    const { payload } = result;
    if (payload.expiresAt && new Date(payload.expiresAt) < new Date()) {
      return { valid: false, error: 'License expired' };
    }

    const dbLicense = await this.licenseRepository.findByKey(dto.licenseKey);
    if (dbLicense?.status === LicenseStatus.REVOKED) {
      return { valid: false, error: 'License revoked' };
    }

    return { valid: true, license: payload };
  }

  async findById(id: string): Promise<License> {
    const license = await this.licenseRepository.findById(id);
    if (!license) throw new NotFoundException(`License ${id} not found`);
    return license;
  }

  async findByEmail(email: string): Promise<License[]> {
    return this.licenseRepository.findByEmail(email);
  }

  async findAll(options?: { skip?: number; take?: number }): Promise<License[]> {
    return this.licenseRepository.findAll(options);
  }

  async count(): Promise<number> {
    return this.licenseRepository.count();
  }

  async findByProviderCustomerId(
    provider: PaymentProvider,
    customerId: string
  ): Promise<License | null> {
    return this.licenseRepository.findByProviderCustomerId(provider, customerId);
  }

  async revoke(id: string, reason: string): Promise<License> {
    await this.findById(id);
    return this.licenseRepository.revoke(id, reason);
  }

  async upgradeFromWebhook(params: {
    provider: PaymentProvider;
    providerCustomerId: string;
    newTier: LicenseTier;
  }): Promise<License | null> {
    const existing = await this.findByProviderCustomerId(
      params.provider,
      params.providerCustomerId
    );
    if (!existing) return null;

    const limits = TIER_LIMITS[params.newTier];
    const payload: LicensePayload = {
      email: existing.email,
      tier: params.newTier,
      maxNodes: limits.maxNodes,
      maxConcurrentJobs: limits.maxConcurrentJobs,
      expiresAt: null,
      issuedAt: new Date().toISOString(),
    };

    const newKey = this.cryptoService.generateLicenseKey(payload);
    return this.licenseRepository.update(existing.id, {
      key: newKey,
      tier: params.newTier,
      maxNodes: limits.maxNodes,
      maxConcurrentJobs: limits.maxConcurrentJobs,
    });
  }
}
