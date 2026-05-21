import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CloudAuthService } from './cloud-auth.service';

class StartDeviceFlowDto {
  @IsOptional()
  @IsString()
  machineName?: string;
}

@ApiTags('cloud-auth')
@Controller('cloud-auth')
export class CloudAuthController {
  constructor(private readonly cloudAuthService: CloudAuthService) {}

  @Post('start')
  @ApiOperation({ summary: 'Start device authorization flow' })
  startDeviceFlow(@Body() dto: StartDeviceFlowDto) {
    return this.cloudAuthService.startDeviceFlow(dto.machineName);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get cloud account link status' })
  getStatus() {
    return this.cloudAuthService.getStatus();
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlink cloud account' })
  logout() {
    return this.cloudAuthService.logout();
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force re-validation of device token' })
  validateNow() {
    return this.cloudAuthService.validateNow();
  }
}
