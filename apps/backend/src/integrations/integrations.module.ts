import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
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
