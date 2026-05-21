import { HttpService } from '@nestjs/axios';
import { ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export interface Entitlements {
  tier: string;
  maxNodes: number;
  maxConcurrentJobs: number;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  email: string;
}

export interface CloudAuthStatus {
  linked: boolean;
  email: string | null;
  tier: string | null;
  maxNodes: number | null;
  maxConcurrentJobs: number | null;
  validatedAt: Date | null;
  gracePeriodExpiresAt: Date | null;
  gracePeriodExpired: boolean;
}

@Injectable()
export class CloudAuthService implements OnModuleInit {
  private readonly logger = new Logger(CloudAuthService.name);
  private readonly licensingApiUrl: string;
  private readonly productId: string;
  private readonly adminApiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {
    this.licensingApiUrl = this.configService.get<string>(
      'LICENSING_SERVICE_URL',
      'https://api.bitbonsai.app'
    );
    this.productId = this.configService.get<string>('LICENSING_PRODUCT_ID', 'bitbonsai');
    this.adminApiKey = this.configService.getOrThrow<string>('LICENSING_ADMIN_API_KEY');
  }

  async onModuleInit() {
    await this.ensureMachineId();
  }

  async ensureMachineId(): Promise<string> {
    const settings = await this.prisma.settings.findFirst();
    if (!settings) return '';

    if (settings.machineId) return settings.machineId;

    const machineId = randomUUID();
    await this.prisma.settings.update({
      where: { id: settings.id },
      data: { machineId },
    });

    this.logger.log(`Generated machineId: ${machineId}`);
    return machineId;
  }

  async startDeviceFlow(machineName?: string): Promise<{
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
    deviceCode: string;
  }> {
    const machineId = await this.ensureMachineId();

    const response = await firstValueFrom(
      this.httpService.post(
        `${this.licensingApiUrl}/device/code`,
        { productId: this.productId, machineId, machineName },
        { headers: { 'x-admin-api-key': this.adminApiKey } }
      )
    );

    // Start polling in background
    this.pollForToken(response.data.deviceCode).catch((err) =>
      this.logger.error('Device flow polling error', err)
    );

    return response.data;
  }

  async pollForToken(deviceCode: string): Promise<void> {
    const deadline = Date.now() + POLL_MAX_DURATION_MS;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      try {
        const response = await firstValueFrom(
          this.httpService.post(
            `${this.licensingApiUrl}/device/token`,
            { deviceCode },
            { headers: { 'x-admin-api-key': this.adminApiKey } }
          )
        );

        const data = response.data;

        if (data.error === 'authorization_pending') continue;

        if (data.error === 'expired') {
          this.logger.warn('Device flow request expired before user authorized');
          return;
        }

        if (data.deviceToken) {
          await this.storeToken(data.deviceToken, data.entitlements);
          this.logger.log(`Cloud account linked successfully`);
          return;
        }
      } catch (err) {
        this.logger.debug('Poll attempt failed (transient)', err);
      }
    }

    this.logger.warn('Device flow timed out');
  }

  async storeToken(rawToken: string, entitlements: Entitlements): Promise<void> {
    if (
      !entitlements?.tier ||
      entitlements.maxNodes == null ||
      entitlements.maxConcurrentJobs == null
    ) {
      throw new Error(`Invalid entitlements payload: ${JSON.stringify(entitlements)}`);
    }

    const settings = await this.prisma.settings.findFirst();
    if (!settings) return;

    await this.prisma.settings.update({
      where: { id: settings.id },
      data: {
        cloudDeviceToken: rawToken,
        cloudUserEmail: entitlements.email || null,
        cloudTier: entitlements.tier,
        cloudMaxNodes: entitlements.maxNodes,
        cloudMaxConcurrentJobs: entitlements.maxConcurrentJobs,
        cloudValidatedAt: new Date(),
      },
    });
  }

  async validateNow(): Promise<boolean> {
    const settings = await this.prisma.settings.findFirst();
    if (!settings?.cloudDeviceToken || !settings.machineId) return false;

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.licensingApiUrl}/device/entitlements`,
          {},
          {
            headers: {
              'x-admin-api-key': this.adminApiKey,
              'x-device-token': settings.cloudDeviceToken,
              'x-machine-id': settings.machineId,
              'x-product-id': this.productId,
            },
          }
        )
      );

      const entitlements = response.data as Entitlements;
      if (
        !entitlements?.tier ||
        entitlements.maxNodes == null ||
        entitlements.maxConcurrentJobs == null
      ) {
        throw new Error(`Invalid entitlements response: ${JSON.stringify(entitlements)}`);
      }

      await this.prisma.settings.update({
        where: { id: settings.id },
        data: {
          cloudUserEmail: entitlements.email || null,
          cloudTier: entitlements.tier,
          cloudMaxNodes: entitlements.maxNodes,
          cloudMaxConcurrentJobs: entitlements.maxConcurrentJobs,
          cloudValidatedAt: new Date(),
        },
      });

      return true;
    } catch (err) {
      this.logger.warn('Entitlement revalidation failed', err);
      return false;
    }
  }

  async getStatus(): Promise<CloudAuthStatus> {
    const settings = await this.prisma.settings.findFirst();

    const linked = !!settings?.cloudDeviceToken;
    const validatedAt = settings?.cloudValidatedAt ?? null;
    const gracePeriodExpiresAt = validatedAt
      ? new Date(validatedAt.getTime() + GRACE_PERIOD_MS)
      : null;
    const gracePeriodExpired = gracePeriodExpiresAt ? gracePeriodExpiresAt < new Date() : false;

    return {
      linked,
      email: settings?.cloudUserEmail ?? null,
      tier: settings?.cloudTier ?? null,
      maxNodes: settings?.cloudMaxNodes ?? null,
      maxConcurrentJobs: settings?.cloudMaxConcurrentJobs ?? null,
      validatedAt,
      gracePeriodExpiresAt,
      gracePeriodExpired,
    };
  }

  async getEntitlements(): Promise<{ maxNodes: number; maxConcurrentJobs: number; tier: string }> {
    const status = await this.getStatus();

    if (status.gracePeriodExpired) {
      throw new ForbiddenException({
        error: 'CLOUD_AUTH_GRACE_EXPIRED',
        message: 'Cloud account validation expired. Please re-link your bitbonsai.app account.',
        upgradeUrl: '/settings?tab=account',
      });
    }

    // Default to FREE if not linked
    return {
      tier: status.tier ?? 'FREE',
      maxNodes: status.maxNodes ?? 1,
      maxConcurrentJobs: status.maxConcurrentJobs ?? 2,
    };
  }

  async logout(): Promise<void> {
    const settings = await this.prisma.settings.findFirst();
    if (!settings) return;

    if (settings.cloudDeviceToken) {
      try {
        await firstValueFrom(
          this.httpService.delete(`${this.licensingApiUrl}/device/token`, {
            headers: {
              'x-admin-api-key': this.adminApiKey,
              'x-device-token': settings.cloudDeviceToken,
            },
          })
        );
      } catch (err) {
        this.logger.warn('Failed to revoke device token on licensing-service', err);
      }
    }

    await this.prisma.settings.update({
      where: { id: settings.id },
      data: {
        cloudDeviceToken: null,
        cloudUserEmail: null,
        cloudTier: null,
        cloudMaxNodes: null,
        cloudMaxConcurrentJobs: null,
        cloudValidatedAt: null,
      },
    });
  }
}
