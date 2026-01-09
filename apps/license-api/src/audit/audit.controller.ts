import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminApiKeyGuard } from '../security/admin-api-key.guard';
import { AuditService } from './audit.service';

@ApiTags('Admin - Audit Log')
@Controller('admin/audit-log')
@UseGuards(AdminApiKeyGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async getAllLogs(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.auditService.getAllLogs(
      limit ? parseInt(limit, 10) : 100,
      offset ? parseInt(offset, 10) : 0
    );
  }

  @Get('entity/:entityType/:entityId')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async getLogsByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string
  ) {
    return this.auditService.getLogsByEntity(entityType, entityId);
  }

  @Get('user/:userId')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async getLogsByUser(@Param('userId') userId: string) {
    return this.auditService.getLogsByUser(userId);
  }
}
