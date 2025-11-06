import { Module } from '@nestjs/common';
import { HardwareDetectionService } from './hardware-detection.service';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  controllers: [SystemController],
  providers: [SystemService, HardwareDetectionService],
  exports: [SystemService, HardwareDetectionService],
})
export class SystemModule {}
