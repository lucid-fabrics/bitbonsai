import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CommonModule } from './common/common.module';
import { CoreModule } from './core/core.module';
import { DatabaseInitService } from './database/database-init.service';
import { DiscoveryModule } from './discovery/discovery.module';
import { EncodingModule } from './encoding/encoding.module';
import { FilesystemModule } from './filesystem/filesystem.module';
import { HealthModule } from './health/health.module';
import { InsightsModule } from './insights/insights.module';
import { LibrariesModule } from './libraries/libraries.module';
import { LicenseModule } from './license/license.module';
import { LicensesModule } from './licenses/licenses.module';
import { MediaStatsModule } from './media-stats/media-stats.module';
import { NodesModule } from './nodes/nodes.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OverviewModule } from './overview/overview.module';
import { PoliciesModule } from './policies/policies.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { SettingsModule } from './settings/settings.module';
import { SetupModule } from './setup/setup.module';
import { SyncModule } from './sync/sync.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    // SECURITY: Global rate limiting - 100 requests per minute per IP
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 1 minute window
        limit: 100, // 100 requests per minute
      },
    ]),
    EventEmitterModule.forRoot({ global: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CommonModule,
    CoreModule,
    AuthModule,
    DiscoveryModule,
    HealthModule,
    MediaStatsModule,
    NotificationsModule,
    PoliciesModule,
    LicenseModule,
    LicensesModule,
    LibrariesModule,
    FilesystemModule,
    OverviewModule,
    InsightsModule,
    NodesModule,
    QueueModule,
    SettingsModule,
    SetupModule,
    SyncModule,
    EncodingModule,
    SystemModule,
  ],
  controllers: [],
  providers: [
    // Database initialization on startup
    DatabaseInitService,
    // SECURITY: Global JWT authentication guard (applied to all routes except @Public())
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // SECURITY: Global rate limiting guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
