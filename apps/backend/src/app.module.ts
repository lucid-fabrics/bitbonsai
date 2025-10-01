import { Module } from '@nestjs/common';
import { LibrariesModule } from './libraries/libraries.module';
import { LicenseModule } from './license/license.module';
import { MediaStatsModule } from './media-stats/media-stats.module';
import { PoliciesModule } from './policies/policies.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, MediaStatsModule, PoliciesModule, LicenseModule, LibrariesModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
