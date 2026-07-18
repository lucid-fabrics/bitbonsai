import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { EncodingModule } from '../encoding/encoding.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';
import { SelfTestService } from './self-test.service';

/**
 * SelfTestModule
 *
 * Nightly encoding regression harness (see self-test.service.ts). Only
 * consumes EncodingModule/QueueModule/NotificationsModule - nothing in
 * those modules depends on this one, so no forwardRef is needed.
 */
@Module({
  imports: [CoreModule, EncodingModule, QueueModule, NotificationsModule],
  providers: [SelfTestService],
})
export class SelfTestModule {}
