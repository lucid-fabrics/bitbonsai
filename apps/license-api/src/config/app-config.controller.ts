import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminApiKeyGuard } from '../security/admin-api-key.guard';
import { AppConfigService, CreateConfigDto, UpdateConfigDto } from './app-config.service';

@ApiTags('Admin - Configuration')
@Controller('admin/config')
@UseGuards(AdminApiKeyGuard)
@ApiBearerAuth()
export class AppConfigController {
  constructor(private readonly configService: AppConfigService) {}

  @Get()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async getAllConfigs() {
    return this.configService.getAllConfigs();
  }

  @Get(':key')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async getConfig(@Param('key') key: string) {
    return this.configService.getConfig(key, false);
  }

  @Get(':key/unmask')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async getConfigUnmasked(@Param('key') key: string) {
    return this.configService.getConfig(key, true);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async setConfig(@Body() dto: CreateConfigDto) {
    const adminUserId = 'admin'; // TODO: Extract from request context
    await this.configService.setConfig(dto, adminUserId);
    return { success: true };
  }

  @Put(':key')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async updateConfigValue(@Param('key') key: string, @Body() dto: UpdateConfigDto) {
    const adminUserId = 'admin';
    await this.configService.updateConfigValue(key, dto.value, adminUserId);
    return { success: true };
  }

  @Delete(':key')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async deleteConfig(@Param('key') key: string) {
    const adminUserId = 'admin';
    await this.configService.deleteConfig(key, adminUserId);
    return { success: true };
  }
}
