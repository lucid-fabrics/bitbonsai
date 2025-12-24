import { Global, Module } from '@nestjs/common';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { SecurityLoggerService } from './security-logger.service';

@Global()
@Module({
  providers: [SecurityLoggerService, AdminApiKeyGuard],
  exports: [SecurityLoggerService, AdminApiKeyGuard],
})
export class SecurityModule {}
