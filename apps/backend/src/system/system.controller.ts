import { Controller, Get } from '@nestjs/common';
import { SystemService } from './system.service';

@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('resources')
  getSystemResources() {
    return this.systemService.getSystemResources();
  }
}
