import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PatreonController } from './patreon.controller';
import { PatreonService } from './patreon.service';
import { PatreonTokenRefreshTask } from './patreon-token-refresh.task';

/**
 * PatreonModule
 *
 * Provides Patreon OAuth and webhook integration for automatic license activation.
 *
 * Features:
 * - OAuth flow for user-initiated Patreon connection
 * - Automatic token refresh (daily cron job at 2 AM)
 * - License tier mapping based on pledge amount
 *
 * Required environment variables:
 * - PATREON_CLIENT_ID: OAuth client ID from Patreon
 * - PATREON_CLIENT_SECRET: OAuth client secret
 * - PATREON_WEBHOOK_SECRET: Webhook signature verification secret
 * - PATREON_REDIRECT_URI: OAuth callback URL (optional, defaults to /api/v1/patreon/callback)
 */
@Module({
  imports: [HttpModule, PrismaModule],
  controllers: [PatreonController],
  providers: [PatreonService, PatreonTokenRefreshTask],
  exports: [PatreonService],
})
export class PatreonModule {}
