import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { CloudAuthService } from './cloud-auth.service';

class StartDeviceFlowDto {
  @IsOptional()
  @IsString()
  machineName?: string;
}

@Controller('cloud-auth')
export class CloudAuthController {
  constructor(private readonly cloudAuthService: CloudAuthService) {}

  @Post('start')
  startDeviceFlow(@Body() dto: StartDeviceFlowDto) {
    return this.cloudAuthService.startDeviceFlow(dto.machineName);
  }

  @Get('status')
  getStatus() {
    return this.cloudAuthService.getStatus();
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout() {
    return this.cloudAuthService.logout();
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validateNow() {
    return this.cloudAuthService.validateNow();
  }
}
