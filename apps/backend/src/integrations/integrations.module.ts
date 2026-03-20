import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { JobRepository } from '../common/repositories/job.repository';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { JellyfinIntegrationService } from './jellyfin.service';
import { PlexIntegrationService } from './plex.service';
import { RadarrSonarrIntegrationService } from './radarr-sonarr.service';
import { StripeModule } from './stripe/stripe.module';
import { TorrentIntegrationService } from './torrent.service';

@Module({
  imports: [PrismaModule, HttpModule, StripeModule],
  providers: [
    JellyfinIntegrationService,
    PlexIntegrationService,
    TorrentIntegrationService,
    RadarrSonarrIntegrationService,
    SettingsRepository,
    JobRepository,
  ],
  exports: [
    JellyfinIntegrationService,
    PlexIntegrationService,
    TorrentIntegrationService,
    RadarrSonarrIntegrationService,
    StripeModule,
  ],
})
export class IntegrationsModule {}
