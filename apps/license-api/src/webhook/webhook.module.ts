import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { LicenseModule } from '../license/license.module';
import { PricingModule } from '../pricing/pricing.module';
import { WebhookService } from './_services/webhook.service';
import { KofiController } from './kofi.controller';
import { PatreonController } from './patreon.controller';
import { StripeController } from './stripe.controller';

@Module({
  imports: [LicenseModule, PricingModule, EmailModule],
  controllers: [PatreonController, StripeController, KofiController],
  providers: [WebhookService],
})
export class WebhookModule {}
