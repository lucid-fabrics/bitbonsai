import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AppConfigModule } from '../config/app-config.module';
import { validate } from '../config/env.validation';
import { CryptoModule } from '../crypto/crypto.module';
import { EmailModule } from '../email/email.module';
import { HealthModule } from '../health/health.module';
import { LicenseModule } from '../license/license.module';
import { PricingModule } from '../pricing/pricing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PromoModule } from '../promo/promo.module';
import { SecurityModule } from '../security/security.module';
import { StripeModule } from '../stripe/stripe.module';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 10,
      },
      {
        name: 'medium',
        ttl: 10000,
        limit: 50,
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 100,
      },
    ]),
    SecurityModule,
    PrismaModule,
    CryptoModule,
    EmailModule,
    HealthModule,
    AuditModule,
    AnalyticsModule,
    AuthModule,
    LicenseModule,
    PricingModule,
    PromoModule,
    AppConfigModule,
    WebhookModule,
    StripeModule,
  ],
})
export class AppModule {}
