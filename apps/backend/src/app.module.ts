import { Module } from '@nestjs/common';
import { InsightsModule } from './insights/insights.module';
import { LibrariesModule } from './libraries/libraries.module';
import { LicenseModule } from './license/license.module';
import { MediaStatsModule } from './media-stats/media-stats.module';
import { NodesModule } from './nodes/nodes.module';
import { OverviewModule } from './overview/overview.module';
import { PoliciesModule } from './policies/policies.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    PrismaModule,
    MediaStatsModule,
    PoliciesModule,
    LicenseModule,
    LibrariesModule,
    OverviewModule,
    InsightsModule,
    NodesModule,
    QueueModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
