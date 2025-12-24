import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-admin-api-key'];
    const validKey = this.config.get('ADMIN_API_KEY');

    if (!validKey) {
      throw new Error('ADMIN_API_KEY not configured');
    }

    if (!apiKey || apiKey !== validKey) {
      throw new UnauthorizedException('Invalid admin API key');
    }

    return true;
  }
}
