import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { EncodingModule } from './encoding/encoding.module';
import { InsightsModule } from './insights/insights.module';
import { LibrariesModule } from './libraries/libraries.module';
import { LicenseModule } from './license/license.module';
import { LicensesModule } from './licenses/licenses.module';
import { MediaStatsModule } from './media-stats/media-stats.module';
import { NodesModule } from './nodes/nodes.module';
import { OverviewModule } from './overview/overview.module';
import { PoliciesModule } from './policies/policies.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    MediaStatsModule,
    PoliciesModule,
    LicenseModule,
    LicensesModule,
    LibrariesModule,
    OverviewModule,
    InsightsModule,
    NodesModule,
    QueueModule,
    SettingsModule,
    EncodingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
