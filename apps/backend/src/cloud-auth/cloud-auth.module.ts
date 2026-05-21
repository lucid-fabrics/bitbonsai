import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CloudAuthController } from './cloud-auth.controller';
import { CloudAuthScheduler } from './cloud-auth.scheduler';
import { CloudAuthService } from './cloud-auth.service';

@Module({
  imports: [PrismaModule, HttpModule.register({ timeout: 10000, maxRedirects: 3 })],
  controllers: [CloudAuthController],
  providers: [CloudAuthService, CloudAuthScheduler],
  exports: [CloudAuthService],
})
export class CloudAuthModule {}
