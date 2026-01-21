import type { LicenseFeatures } from '@bitbonsai/prisma-types';
import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LicenseStatus, LicenseTier, type Prisma } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { mapExternalTier } from '../license/tier-mapping';
import { PrismaService } from '../prisma/prisma.service';
import type { ActivateLicenseDto } from './dto/activate-license.dto';

interface VerifyLicenseResponse {
  valid: boolean;
  error?: string;
  license?: {
    email: string;
    tier: string;
    maxNodes: number;
    maxConcurrentJobs: number;
    expiresAt: string | null;
  };
}

interface LookupLicenseResponse {
  found: boolean;
  license?: {
    tier: string;
    maxNodes: number;
    maxConcurrentJobs: number;
    maskedKey: string;
    expiresAt: string | null;
  };
}

@Injectable()
export class LicensesService {
  private readonly logger = new Logger(LicensesService.name);
  private readonly licenseApiUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {
    this.licenseApiUrl =
      this.configService.get<string>('LICENSE_API_URL') || 'https://api.bitbonsai.app';
  }

  /**
   * Verify and activate a license key
   *
   * 1. Call licensing-service to verify the key
   * 2. Map external tier to internal tier
   * 3. Create/update local license record
   * 4. Return activated license details
   */
  async activateLicense(dto: ActivateLicenseDto): Promise<{
    tier: LicenseTier;
    email: string;
    maxNodes: number;
    maxConcurrentJobs: number;
    expiresAt: Date | null;
  }> {
    this.logger.log(`Verifying license for ${dto.email}`);

    // Call licensing-service verify endpoint
    let verifyResponse: VerifyLicenseResponse;
    try {
      const response = await firstValueFrom(
        this.httpService.post<VerifyLicenseResponse>(
          `${this.licenseApiUrl}/api/licenses/verify`,
          { licenseKey: dto.licenseKey },
          { timeout: 10000 }
        )
      );
      verifyResponse = response.data;
    } catch (error) {
      // Distinguish between different error types for better UX
      const axiosError = error as { code?: string; response?: { status?: number } };

      if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
        this.logger.error('License verification timed out', error);
        throw new ServiceUnavailableException('License server is slow to respond. Please try again.');
      }

      if (axiosError.response?.status === 429) {
        this.logger.warn('Rate limited by licensing service');
        throw new HttpException('Too many license verification attempts. Please wait a moment.', HttpStatus.TOO_MANY_REQUESTS);
      }

      if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
        this.logger.error('Cannot connect to licensing service', error);
        throw new ServiceUnavailableException('License server is unavailable. Please try again later.');
      }

      this.logger.error('Failed to verify license with licensing-service', error);
      throw new ServiceUnavailableException('Unable to verify license. Please try again later.');
    }

    if (!verifyResponse.valid || !verifyResponse.license) {
      const errorMsg = verifyResponse.error || 'Invalid license key';
      this.logger.warn(`License verification failed: ${errorMsg}`);
      throw new BadRequestException(errorMsg);
    }

    const externalLicense = verifyResponse.license;
    const internalTier = mapExternalTier(externalLicense.tier, this.logger);

    // Determine features based on tier
    const features = this.getTierFeatures(internalTier);

    // Atomic upsert in transaction with timeout to prevent long-running queries
    await this.prisma.$transaction(
      async (tx) => {
        await tx.license.upsert({
          where: { email: dto.email },
          update: {
            key: dto.licenseKey,
            tier: internalTier,
            status: LicenseStatus.ACTIVE,
            maxNodes: externalLicense.maxNodes,
            maxConcurrentJobs: externalLicense.maxConcurrentJobs,
            features: features as unknown as Prisma.InputJsonValue,
            validUntil: externalLicense.expiresAt ? new Date(externalLicense.expiresAt) : null,
          },
          create: {
            key: dto.licenseKey,
            tier: internalTier,
            status: LicenseStatus.ACTIVE,
            email: dto.email,
            maxNodes: externalLicense.maxNodes,
            maxConcurrentJobs: externalLicense.maxConcurrentJobs,
            features: features as unknown as Prisma.InputJsonValue,
            validUntil: externalLicense.expiresAt ? new Date(externalLicense.expiresAt) : null,
          },
        });
      },
      { timeout: 5000 }
    );
    this.logger.log(`Upserted license for ${dto.email} with tier ${internalTier}`);

    return {
      tier: internalTier,
      email: dto.email,
      maxNodes: externalLicense.maxNodes,
      maxConcurrentJobs: externalLicense.maxConcurrentJobs,
      expiresAt: externalLicense.expiresAt ? new Date(externalLicense.expiresAt) : null,
    };
  }

  /**
   * Lookup license by email (for post-Stripe flow)
   */
  async lookupLicenseByEmail(email: string): Promise<LookupLicenseResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<LookupLicenseResponse>(
          `${this.licenseApiUrl}/api/licenses/lookup`,
          { email },
          { timeout: 10000 }
        )
      );
      return response.data;
    } catch (error) {
      // Distinguish between different error types for better UX
      const axiosError = error as { code?: string; response?: { status?: number } };

      if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
        this.logger.error('License lookup timed out', error);
        throw new ServiceUnavailableException('License server is slow to respond. Please try again.');
      }

      if (axiosError.response?.status === 429) {
        this.logger.warn('Rate limited by licensing service');
        throw new HttpException('Too many license lookup attempts. Please wait a moment.', HttpStatus.TOO_MANY_REQUESTS);
      }

      if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
        this.logger.error('Cannot connect to licensing service', error);
        throw new ServiceUnavailableException('License server is unavailable. Please try again later.');
      }

      this.logger.error('Failed to lookup license', error);
      throw new ServiceUnavailableException('Unable to lookup license. Please try again later.');
    }
  }

  /**
   * Get features for a given tier
   */
  private getTierFeatures(tier: LicenseTier): LicenseFeatures {
    const isPatreonProOrHigher =
      tier === LicenseTier.PATREON_PRO || tier === LicenseTier.PATREON_ULTIMATE;
    const isCommercial = tier.startsWith('COMMERCIAL');

    return {
      multiNode: tier !== LicenseTier.FREE,
      advancedPresets: tier !== LicenseTier.FREE,
      api: isPatreonProOrHigher || isCommercial,
      priorityQueue: isPatreonProOrHigher || isCommercial,
      cloudStorage: isCommercial,
      webhooks: isPatreonProOrHigher || isCommercial,
    };
  }
}
