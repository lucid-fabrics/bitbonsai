import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { DiscordNotificationService } from './integrations/discord.service';
import { EmailNotificationService } from './integrations/email.service';
import { SlackNotificationService } from './integrations/slack.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PrismaModule, HttpModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    DiscordNotificationService,
    SlackNotificationService,
    EmailNotificationService,
    SettingsRepository,
  ],
  exports: [
    NotificationsService,
    NotificationsGateway,
    DiscordNotificationService,
    SlackNotificationService,
    EmailNotificationService,
  ],
})
export class NotificationsModule {}
