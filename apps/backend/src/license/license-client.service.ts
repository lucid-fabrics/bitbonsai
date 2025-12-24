import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as crypto from 'crypto';
import * as os from 'os';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

export interface LicenseInfo {
  key: string;
  email: string;
  tier: string;
  status: string;
  maxNodes: number;
  maxConcurrentJobs: number;
  expiresAt: Date | null;
}

@Injectable()
export class LicenseClientService {
  private readonly logger = new Logger(LicenseClientService.name);
  private readonly apiUrl: string;
  private cachedLicense: LicenseInfo | null = null;
  private lastVerification: Date | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService
  ) {
    this.apiUrl = this.configService.get('LICENSE_API_URL') || 'https://api.bitbonsai.io';
  }

  async getLicenseKey(): Promise<string | null> {
    const settings = await this.prisma.settings.findFirst();
    return settings?.licenseKey || null;
  }

  async setLicenseKey(key: string): Promise<void> {
    const settings = await this.prisma.settings.findFirst();

    if (settings) {
      await this.prisma.settings.update({
        where: { id: settings.id },
        data: { licenseKey: key },
      });
    } else {
      await this.prisma.settings.create({
        data: { licenseKey: key },
      });
    }

    // Immediately verify new license
    await this.verifyLicense();
  }

  async verifyLicense(): Promise<LicenseInfo> {
    const now = new Date();

    // Return cache if verified within 24h
    if (this.cachedLicense && this.lastVerification) {
      const hoursSinceVerification =
        (now.getTime() - this.lastVerification.getTime()) / (1000 * 60 * 60);
      if (hoursSinceVerification < 24) {
        this.logger.debug('Using cached license (verified within 24h)');
        return this.cachedLicense;
      }
    }

    const licenseKey = await this.getLicenseKey();

    if (!licenseKey) {
      // No license key = FREE tier
      this.logger.warn('No license key configured - using FREE tier');
      const freeLicense: LicenseInfo = {
        key: 'FREE',
        email: 'free@bitbonsai.io',
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
            timeout: 10000, // 10s timeout
          }
        )
      );

      this.cachedLicense = response.data;
      this.lastVerification = now;

      // Update last verified timestamp in DB
      const settings = await this.prisma.settings.findFirst();
      if (settings) {
        await this.prisma.settings.update({
          where: { id: settings.id },
          data: { licenseLastVerified: now },
        });
      }

      this.logger.log(
        `License verified: ${this.cachedLicense.tier} (${this.cachedLicense.maxNodes} nodes, ${this.cachedLicense.maxConcurrentJobs} jobs)`
      );

      return this.cachedLicense;
    } catch (error) {
      // Graceful degradation: use cached license if API unreachable
      if (this.cachedLicense) {
        this.logger.warn('License API unreachable, using cached license');
        return this.cachedLicense;
      }

      this.logger.error('License verification failed and no cache available', error.message);
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
    } catch (error) {
      this.logger.error('Daily license verification failed', error.message);
    }
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
