import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { LicenseStatus, LicenseTier } from '@prisma/client';
import { createHmac } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Patreon tier mapping to BitBonsai license tiers
 */
const PATREON_TIER_MAP: Record<number, LicenseTier> = {
  // Map Patreon tier amounts (in cents) to license tiers
  300: LicenseTier.PATREON_SUPPORTER, // $3/mo
  500: LicenseTier.PATREON_PLUS, // $5/mo
  1000: LicenseTier.PATREON_PRO, // $10/mo
  2000: LicenseTier.PATREON_ULTIMATE, // $20/mo
};

/**
 * Patreon member data from API
 */
interface PatreonMember {
  id: string;
  email: string;
  fullName: string;
  pledgeAmountCents: number;
  status: 'active_patron' | 'declined_patron' | 'former_patron';
  tierTitle?: string;
}

/**
 * Patreon webhook payload
 */
interface PatreonWebhookPayload {
  data: {
    id: string;
    type: string;
    attributes: {
      currently_entitled_amount_cents: number;
      email: string;
      full_name: string;
      patron_status: string;
      last_charge_status: string;
    };
    relationships?: {
      currently_entitled_tiers?: {
        data: Array<{ id: string; type: string }>;
      };
    };
  };
  included?: Array<{
    id: string;
    type: string;
    attributes: Record<string, unknown>;
  }>;
}

/**
 * PatreonService
 *
 * Handles Patreon OAuth flow and webhook integration for automatic license activation.
 *
 * Flow:
 * 1. User clicks "Connect Patreon" in settings
 * 2. Redirects to Patreon OAuth with our client ID
 * 3. User authorizes BitBonsai
 * 4. Patreon redirects back with auth code
 * 5. We exchange code for access token
 * 6. Fetch user's membership/pledge info
 * 7. Create/update license based on pledge amount
 *
 * Webhooks:
 * - members:pledge:create - New pledge, activate license
 * - members:pledge:update - Tier change, update license
 * - members:pledge:delete - Pledge cancelled, downgrade to FREE
 */
@Injectable()
export class PatreonService {
  private readonly logger = new Logger(PatreonService.name);

  private readonly clientId = process.env.PATREON_CLIENT_ID;
  private readonly clientSecret = process.env.PATREON_CLIENT_SECRET;
  private readonly webhookSecret = process.env.PATREON_WEBHOOK_SECRET;
  private readonly redirectUri =
    process.env.PATREON_REDIRECT_URI || 'http://localhost:3100/api/v1/patreon/callback';

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Get Patreon OAuth authorization URL
   */
  getAuthorizationUrl(state?: string): string {
    if (!this.clientId) {
      throw new Error('PATREON_CLIENT_ID not configured');
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: 'identity identity[email] campaigns campaigns.members',
      state: state || '',
    });

    return `https://www.patreon.com/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchange OAuth code for access token
   */
  async exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Patreon OAuth not configured');
    }

    const response = await firstValueFrom(
      this.httpService.post(
        'https://www.patreon.com/api/oauth2/token',
        new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      )
    );

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
    };
  }

  /**
   * Get current user's Patreon membership info
   */
  async getMembershipInfo(accessToken: string): Promise<PatreonMember | null> {
    try {
      // Get identity with memberships
      const response = await firstValueFrom(
        this.httpService.get(
          'https://www.patreon.com/api/oauth2/v2/identity?include=memberships&fields[user]=email,full_name&fields[member]=currently_entitled_amount_cents,patron_status',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        )
      );

      const userData = response.data.data;
      const memberships = response.data.included?.filter(
        (i: { type: string }) => i.type === 'member'
      );

      if (!memberships || memberships.length === 0) {
        return null;
      }

      // Find active membership (for our campaign)
      const membership = memberships[0];
      const attributes = membership.attributes;

      return {
        id: userData.id,
        email: userData.attributes.email,
        fullName: userData.attributes.full_name,
        pledgeAmountCents: attributes.currently_entitled_amount_cents || 0,
        status: attributes.patron_status || 'former_patron',
      };
    } catch (error) {
      this.logger.error('Failed to get Patreon membership info', error);
      return null;
    }
  }

  /**
   * Activate or update license based on Patreon membership
   */
  async activateLicenseFromPatreon(member: PatreonMember): Promise<void> {
    const tier = this.getTierFromPledgeAmount(member.pledgeAmountCents);

    if (member.status !== 'active_patron' || tier === LicenseTier.FREE) {
      this.logger.log(`Patreon member ${member.email} is not active or pledge too low`);
      return;
    }

    // Find or create license
    const license = await this.prisma.license.findFirst({
      where: { email: member.email },
    });

    if (license) {
      // Update existing license
      await this.prisma.license.update({
        where: { id: license.id },
        data: {
          tier,
          status: LicenseStatus.ACTIVE,
          patreonId: member.id,
        },
      });
      this.logger.log(`Updated license for ${member.email} to ${tier}`);
    } else {
      // Create new license
      const tierConfig = this.getTierConfig(tier);
      await this.prisma.license.create({
        data: {
          key: this.generateLicenseKey(tier),
          tier,
          status: LicenseStatus.ACTIVE,
          email: member.email,
          patreonId: member.id,
          maxNodes: tierConfig.maxNodes,
          maxConcurrentJobs: tierConfig.maxConcurrentJobs,
          features: tierConfig.features,
        },
      });
      this.logger.log(`Created new license for ${member.email} at ${tier}`);
    }
  }

  /**
   * Handle Patreon webhook
   */
  async handleWebhook(
    signature: string,
    payload: PatreonWebhookPayload,
    rawBody: string
  ): Promise<void> {
    // Verify webhook signature
    if (!this.verifyWebhookSignature(signature, rawBody)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const eventType = payload.data.type;
    const attributes = payload.data.attributes;

    this.logger.log(`Received Patreon webhook: ${eventType}`);

    const member: PatreonMember = {
      id: payload.data.id,
      email: attributes.email,
      fullName: attributes.full_name,
      pledgeAmountCents: attributes.currently_entitled_amount_cents,
      status: attributes.patron_status as PatreonMember['status'],
    };

    switch (eventType) {
      case 'members:pledge:create':
      case 'members:pledge:update':
        await this.activateLicenseFromPatreon(member);
        break;

      case 'members:pledge:delete':
        await this.deactivateLicense(member.email);
        break;

      default:
        this.logger.warn(`Unhandled Patreon webhook type: ${eventType}`);
    }
  }

  /**
   * Deactivate license when pledge is cancelled
   */
  private async deactivateLicense(email: string): Promise<void> {
    const license = await this.prisma.license.findFirst({
      where: { email },
    });

    if (license) {
      await this.prisma.license.update({
        where: { id: license.id },
        data: {
          tier: LicenseTier.FREE,
          status: LicenseStatus.EXPIRED,
        },
      });
      this.logger.log(`Deactivated license for ${email}`);
    }
  }

  /**
   * Verify Patreon webhook signature
   */
  private verifyWebhookSignature(signature: string, rawBody: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('PATREON_WEBHOOK_SECRET not configured, skipping signature verification');
      return true;
    }

    const expectedSignature = createHmac('md5', this.webhookSecret).update(rawBody).digest('hex');

    return signature === expectedSignature;
  }

  /**
   * Get license tier from pledge amount
   */
  private getTierFromPledgeAmount(amountCents: number): LicenseTier {
    // Find highest matching tier
    const amounts = Object.keys(PATREON_TIER_MAP)
      .map(Number)
      .sort((a, b) => b - a);

    for (const amount of amounts) {
      if (amountCents >= amount) {
        return PATREON_TIER_MAP[amount];
      }
    }

    return LicenseTier.FREE;
  }

  /**
   * Get tier configuration
   */
  private getTierConfig(tier: LicenseTier) {
    const configs: Record<
      LicenseTier,
      { maxNodes: number; maxConcurrentJobs: number; features: object }
    > = {
      [LicenseTier.FREE]: { maxNodes: 1, maxConcurrentJobs: 2, features: {} },
      [LicenseTier.PATREON]: {
        maxNodes: 2,
        maxConcurrentJobs: 3,
        features: { multiNode: true, advancedPresets: true },
      },
      [LicenseTier.PATREON_SUPPORTER]: {
        maxNodes: 2,
        maxConcurrentJobs: 3,
        features: { multiNode: true, advancedPresets: true },
      },
      [LicenseTier.PATREON_PLUS]: {
        maxNodes: 3,
        maxConcurrentJobs: 5,
        features: { multiNode: true, advancedPresets: true },
      },
      [LicenseTier.PATREON_PRO]: {
        maxNodes: 5,
        maxConcurrentJobs: 10,
        features: {
          multiNode: true,
          advancedPresets: true,
          api: true,
          webhooks: true,
          priorityQueue: true,
        },
      },
      [LicenseTier.PATREON_ULTIMATE]: {
        maxNodes: 10,
        maxConcurrentJobs: 20,
        features: {
          multiNode: true,
          advancedPresets: true,
          api: true,
          webhooks: true,
          priorityQueue: true,
        },
      },
      [LicenseTier.COMMERCIAL_STARTER]: {
        maxNodes: 15,
        maxConcurrentJobs: 30,
        features: {
          multiNode: true,
          advancedPresets: true,
          api: true,
          webhooks: true,
          priorityQueue: true,
          cloudStorage: true,
        },
      },
      [LicenseTier.COMMERCIAL_PRO]: {
        maxNodes: 50,
        maxConcurrentJobs: 100,
        features: {
          multiNode: true,
          advancedPresets: true,
          api: true,
          webhooks: true,
          priorityQueue: true,
          cloudStorage: true,
        },
      },
      [LicenseTier.COMMERCIAL_ENTERPRISE]: {
        maxNodes: 999,
        maxConcurrentJobs: 999,
        features: {
          multiNode: true,
          advancedPresets: true,
          api: true,
          webhooks: true,
          priorityQueue: true,
          cloudStorage: true,
        },
      },
    };

    return configs[tier];
  }

  /**
   * Generate license key
   */
  private generateLicenseKey(tier: LicenseTier): string {
    const prefix = tier.substring(0, 3).toUpperCase();
    const random = Math.random().toString(36).substring(2, 12);
    return `${prefix}-${random}`;
  }

  /**
   * Check if Patreon is configured
   */
  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }
}
