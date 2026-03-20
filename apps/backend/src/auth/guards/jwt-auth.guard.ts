import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { SettingsRepository } from '../../common/repositories/settings.repository';
import { extractClientIp, isLocalNetworkIp } from '../utils/ip-detector.util';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * JWT Authentication Guard
 *
 * SECURITY FEATURES:
 * - Global authentication by default (all routes require JWT)
 * - @Public() decorator to bypass authentication
 * - Optional local network bypass (configurable via settings)
 * - IP-based validation for local network bypass
 * - Comprehensive audit logging
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private reflector: Reflector,
    private settingsRepository: SettingsRepository
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // SECURITY: Check if local network bypass is enabled (requires explicit setting)
    const settings = await this.settingsRepository.findFirst();
    if (settings?.allowLocalNetworkWithoutAuth) {
      const request = context.switchToHttp().getRequest();
      const clientIp = extractClientIp(request);

      if (isLocalNetworkIp(clientIp)) {
        // SECURITY: Log local network bypass for audit trail
        this.logger.debug(
          `Local network authentication bypass: IP=${clientIp}, Path=${request.url}, Method=${request.method}`
        );
        // Allow access for local network IPs when bypass is enabled
        return true;
      }
    }

    // Default: require JWT authentication
    const result = super.canActivate(context);
    return result as Promise<boolean>;
  }
}
