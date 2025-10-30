import { Controller, Get } from '@nestjs/common';
import { SystemService } from './system.service';

@Controller('api/v1/system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('resources')
  getSystemResources() {
    return this.systemService.getSystemResources();
  }
}
