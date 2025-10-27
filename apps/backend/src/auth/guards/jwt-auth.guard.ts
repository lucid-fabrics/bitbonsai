import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../prisma/prisma.service';
import { extractClientIp, isLocalNetworkIp } from '../utils/ip-detector.util';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService
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

    // Check if local network bypass is enabled
    const settings = await this.prisma.settings.findFirst();
    if (settings?.allowLocalNetworkWithoutAuth) {
      const request = context.switchToHttp().getRequest();
      const clientIp = extractClientIp(request);

      if (isLocalNetworkIp(clientIp)) {
        // Allow access for local network IPs when bypass is enabled
        return true;
      }
    }

    // Default: require JWT authentication
    const result = super.canActivate(context);
    return result as Promise<boolean>;
  }
}
