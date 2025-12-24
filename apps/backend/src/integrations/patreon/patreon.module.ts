import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PatreonController } from './patreon.controller';
import { PatreonService } from './patreon.service';

/**
 * PatreonModule
 *
 * Provides Patreon OAuth and webhook integration for automatic license activation.
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
  providers: [PatreonService],
  exports: [PatreonService],
})
export class PatreonModule {}
