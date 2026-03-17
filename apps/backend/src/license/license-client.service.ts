import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LicenseStatus, type Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as os from 'os';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { getTierFeatures, TIER_LIMITS } from './tier-config';
import { mapExternalTier } from './tier-mapping';

export interface LicenseInfo {
  key: string;
  email: string;
  tier: string;
  status: string;
  maxNodes: number;
  maxConcurrentJobs: number;
  expiresAt: Date | null;
}

export interface LookupLicenseResponse {
  found: boolean;
  license?: {
    tier: string;
    maxNodes: number;
    maxConcurrentJobs: number;
    maskedKey: string;
    expiresAt: string | null;
  };
}

// Default HTTP timeout for all license API calls (10 seconds)
const DEFAULT_HTTP_TIMEOUT = 10000;

// Cache TTL in hours (configurable via LICENSE_CACHE_TTL_HOURS env var)
const DEFAULT_CACHE_TTL_HOURS = 24;

@Injectable()
export class LicenseClientService {
  private readonly logger = new Logger(LicenseClientService.name);
  private readonly apiUrl: string;
  private readonly cacheTtlHours: number;
  private cachedLicense: LicenseInfo | null = null;
  private lastVerification: Date | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService
  ) {
    const configuredUrl = this.configService.get('LICENSE_API_URL') || 'https://api.bitbonsai.app';

    // M4: Enforce HTTPS in production
    if (!configuredUrl.startsWith('https://') && process.env.NODE_ENV === 'production') {
      throw new Error('LICENSE_API_URL must use HTTPS in production');
    }

    this.apiUrl = configuredUrl;
    this.cacheTtlHours =
      this.configService.get<number>('LICENSE_CACHE_TTL_HOURS') || DEFAULT_CACHE_TTL_HOURS;
  }

  /**
   * Mask a license key for display (show only last 4 characters)
   */
  private maskLicenseKey(key: string): string {
    if (!key || key.length < 8) return '****';
    const lastFour = key.slice(-4);
    const prefix = key.includes('-') ? `${key.split('-').slice(0, -1).join('-')}-` : '';
    return `${prefix}****${lastFour}`;
  }

  async getLicenseKey(): Promise<string | null> {
    const license = await this.prisma.license.findFirst();
    return license?.key || null;
  }

  async setLicenseKey(key: string): Promise<void> {
    const existingLicense = await this.prisma.license.findUnique({
      where: { key },
    });

    if (existingLicense) {
      // License already exists, just update it
      await this.prisma.license.update({
        where: { key },
        data: { updatedAt: new Date() },
      });
    } else {
      // This should not happen - license creation happens via API
      throw new Error('License must be validated via API before use');
    }
  }

  async verifyLicense(): Promise<LicenseInfo> {
    const now = new Date();

    // Return cache if verified within configured TTL
    if (this.cachedLicense && this.lastVerification) {
      const hoursSinceVerification =
        (now.getTime() - this.lastVerification.getTime()) / (1000 * 60 * 60);
      if (hoursSinceVerification < this.cacheTtlHours) {
        this.logger.debug(`Using cached license (verified within ${this.cacheTtlHours}h)`);
        // Return with masked key for security
        return {
          ...this.cachedLicense,
          key: this.maskLicenseKey(this.cachedLicense.key),
        };
      }
    }

    const licenseKey = await this.getLicenseKey();

    if (!licenseKey) {
      // No license key = FREE tier
      this.logger.warn('No license key configured - using FREE tier');
      const freeLicense: LicenseInfo = {
        key: 'FREE',
        email: 'free@bitbonsai.app',
        tier: 'FREE',
        status: 'ACTIVE',
        maxNodes: 1,
        maxConcurrentJobs: 2,
        expiresAt: null,
      };
      this.cachedLicense = freeLicense;
      this.lastVerification = now;
      return freeLicense;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/licenses/verify`,
          {
            key: licenseKey,
            machineId: this.getMachineId(),
            machineName: os.hostname(),
          },
          {
            timeout: DEFAULT_HTTP_TIMEOUT,
          }
        )
      );

      const verifiedLicense = response.data;
      if (!verifiedLicense) {
        throw new Error('License API returned empty response');
      }

      this.cachedLicense = verifiedLicense;
      this.lastVerification = now;

      this.logger.log(
        `License verified: ${verifiedLicense.tier} (${verifiedLicense.maxNodes} nodes, ${verifiedLicense.maxConcurrentJobs} jobs)`
      );

      // Return with masked key for security
      return {
        ...verifiedLicense,
        key: this.maskLicenseKey(verifiedLicense.key),
      };
    } catch (error: unknown) {
      // Log detailed error for debugging
      const errorDetails = this.extractErrorDetails(error);
      this.logger.warn('License API call failed', errorDetails);

      // Graceful degradation: use cached license if API unreachable
      if (this.cachedLicense) {
        this.logger.warn('License API unreachable, using cached license', {
          cacheAge: `${Math.round((now.getTime() - (this.lastVerification?.getTime() || 0)) / 3600000)}h`,
          tier: this.cachedLicense.tier,
        });
        return {
          ...this.cachedLicense,
          key: this.maskLicenseKey(this.cachedLicense.key),
        };
      }

      // Fallback to local database license if API unreachable
      const localLicense = await this.prisma.license.findFirst({
        where: { status: LicenseStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      });

      if (localLicense) {
        this.logger.warn('License API unreachable, using local database license');
        const licenseInfo: LicenseInfo = {
          key: this.maskLicenseKey(localLicense.key),
          email: localLicense.email,
          tier: localLicense.tier,
          status: localLicense.status,
          maxNodes: localLicense.maxNodes,
          maxConcurrentJobs: localLicense.maxConcurrentJobs,
          expiresAt: localLicense.validUntil,
        };
        this.cachedLicense = {
          ...licenseInfo,
          key: localLicense.key, // Store full key in cache
        };
        this.lastVerification = now;
        return licenseInfo;
      }

      this.logger.error('License verification failed and no cache available', errorDetails);
      throw new UnauthorizedException('License verification failed');
    }
  }

  async getCurrentLimits(): Promise<{ maxNodes: number; maxConcurrentJobs: number }> {
    const license = await this.verifyLicense();
    return {
      maxNodes: license.maxNodes,
      maxConcurrentJobs: license.maxConcurrentJobs,
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async dailyLicenseVerification() {
    this.logger.log('Running daily license verification...');
    try {
      await this.verifyLicense();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Daily license verification failed', errorMessage);
    }
  }

  /**
   * Activate a license key by verifying with the licensing-service
   * and storing it locally in the database
   *
   * Uses transaction to prevent race conditions (M6)
   */
  async activateLicense(licenseKey: string, email?: string): Promise<LicenseInfo> {
    this.logger.log(`Activating license key for ${email || 'unknown email'}...`);

    try {
      // Call licensing-service to verify the license key
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/licenses/verify`,
          { licenseKey },
          { timeout: DEFAULT_HTTP_TIMEOUT }
        )
      );

      const result = response.data;
      if (!result?.valid || !result?.license) {
        throw new BadRequestException(result?.error || 'Invalid license key');
      }

      const { license: verifiedPayload } = result;

      // Map external tier to internal tier
      const internalTier = mapExternalTier(verifiedPayload.tier, this.logger);
      const limits = TIER_LIMITS[internalTier];
      const features = getTierFeatures(internalTier);

      // M6: Use transaction to prevent race conditions
      const savedLicense = await this.prisma.$transaction(async (tx) => {
        const existingLicense = await tx.license.findFirst();

        const licenseData = {
          key: licenseKey,
          email: verifiedPayload.email || email || 'unknown@bitbonsai.app',
          tier: internalTier,
          status: LicenseStatus.ACTIVE,
          maxNodes: limits.maxNodes,
          maxConcurrentJobs: limits.maxConcurrentJobs,
          features: features as unknown as Prisma.InputJsonValue,
          validUntil: verifiedPayload.expiresAt ? new Date(verifiedPayload.expiresAt) : null,
        };

        if (existingLicense) {
          const updated = await tx.license.update({
            where: { id: existingLicense.id },
            data: licenseData,
          });
          this.logger.log(`Updated existing license to ${internalTier}`);
          return updated;
        } else {
          const created = await tx.license.create({
            data: licenseData,
          });
          this.logger.log(`Created new license: ${internalTier}`);
          return created;
        }
      });

      // Update cache with full key (for internal use)
      const licenseInfo: LicenseInfo = {
        key: savedLicense.key,
        email: savedLicense.email,
        tier: savedLicense.tier,
        status: savedLicense.status,
        maxNodes: savedLicense.maxNodes,
        maxConcurrentJobs: savedLicense.maxConcurrentJobs,
        expiresAt: savedLicense.validUntil,
      };

      this.cachedLicense = licenseInfo;
      this.lastVerification = new Date();

      // Return with masked key for security
      return {
        ...licenseInfo,
        key: this.maskLicenseKey(licenseInfo.key),
      };
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const errorDetails = this.extractErrorDetails(error);

      // M1: Better error messages based on error type
      if (errorDetails.isNetworkError) {
        this.logger.error('License activation failed - network error', errorDetails);
        throw new ServiceUnavailableException(
          'Unable to reach licensing service. Please check your internet connection and try again.'
        );
      }

      this.logger.error('License activation failed', errorDetails);
      throw new BadRequestException(
        'Failed to activate license. Please check the key and try again.'
      );
    }
  }

  /**
   * Lookup a license by email (for post-checkout flows)
   * Proxies to the licensing-service lookup endpoint
   */
  async lookupLicenseByEmail(email: string): Promise<LookupLicenseResponse> {
    this.logger.log(`Looking up license for email: ${email}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/licenses/lookup`,
          { email },
          { timeout: DEFAULT_HTTP_TIMEOUT }
        )
      );

      const result = response.data;

      if (result?.found && result?.license) {
        // Map external tier to internal tier name for display
        const internalTier = mapExternalTier(result.license.tier, this.logger);
        return {
          found: true,
          license: {
            ...result.license,
            tier: internalTier,
          },
        };
      }

      return { found: false };
    } catch (error: unknown) {
      const errorDetails = this.extractErrorDetails(error);
      this.logger.error('License lookup failed', errorDetails);
      return { found: false };
    }
  }

  /**
   * Extract detailed error information for logging
   */
  private extractErrorDetails(error: unknown): {
    message: string;
    code?: string;
    isNetworkError: boolean;
  } {
    if (error instanceof Error) {
      const axiosError = error as Error & {
        code?: string;
        response?: { status?: number; data?: unknown };
      };

      const isNetworkError =
        axiosError.code === 'ECONNREFUSED' ||
        axiosError.code === 'ETIMEDOUT' ||
        axiosError.code === 'ENOTFOUND' ||
        axiosError.code === 'ENETUNREACH';

      return {
        message: axiosError.message,
        code: axiosError.code,
        isNetworkError,
      };
    }

    return {
      message: 'Unknown error',
      isNetworkError: false,
    };
  }

  private getMachineId(): string {
    // Generate stable machine ID from MAC address + hostname
    const networkInterfaces = os.networkInterfaces();
    const macs = Object.values(networkInterfaces)
      .flat()
      .filter((iface) => iface && !iface.internal && iface.mac !== '00:00:00:00:00:00')
      .map((iface) => iface?.mac);

    const uniqueString = `${macs.join('-')}-${os.hostname()}`;
    return crypto.createHash('sha256').update(uniqueString).digest('hex');
  }
}
