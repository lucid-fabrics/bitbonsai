import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EnvironmentInfoDto } from '../common/dto/environment-info.dto';
import type { EnvironmentService } from '../common/environment.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly environmentService: EnvironmentService) {}

  @Get('environment')
  @ApiOperation({
    summary: 'Get environment information',
    description:
      'Detect runtime environment and return system capabilities, hardware acceleration options, and default paths. Used by setup wizard to provide environment-specific configuration.',
  })
  @ApiResponse({
    status: 200,
    description: 'Environment information retrieved successfully',
    type: EnvironmentInfoDto,
  })
  async getEnvironmentInfo(): Promise<EnvironmentInfoDto> {
    return this.environmentService.getEnvironmentInfo();
  }
}
