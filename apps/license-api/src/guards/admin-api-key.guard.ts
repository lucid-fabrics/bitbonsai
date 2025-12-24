import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { SecurityLoggerService } from '../security/security-logger.service';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly securityLogger: SecurityLoggerService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'] as string;
    const adminApiKey = this.configService.get<string>('ADMIN_API_KEY');
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const endpoint = request.path;
    const userAgent = request.headers['user-agent'];

    if (!adminApiKey) {
      this.securityLogger.logAuthFailure(ip, endpoint, 'Admin API key not configured', userAgent);
      throw new UnauthorizedException('Admin API key not configured');
    }

    if (!apiKey) {
      this.securityLogger.logAuthFailure(ip, endpoint, 'API key required', userAgent);
      throw new UnauthorizedException('API key required');
    }

    // Use constant-time comparison to prevent timing attacks
    const apiKeyBuffer = Buffer.from(apiKey);
    const adminKeyBuffer = Buffer.from(adminApiKey);

    if (apiKeyBuffer.length !== adminKeyBuffer.length) {
      this.securityLogger.logAuthFailure(
        ip,
        endpoint,
        'Invalid API key (length mismatch)',
        userAgent
      );
      throw new UnauthorizedException('Invalid API key');
    }

    if (!timingSafeEqual(apiKeyBuffer, adminKeyBuffer)) {
      this.securityLogger.logAuthFailure(ip, endpoint, 'Invalid API key', userAgent);
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
