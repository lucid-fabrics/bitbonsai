import { Injectable, Logger } from '@nestjs/common';

export enum SecurityEventType {
  AUTH_FAILURE = 'AUTH_FAILURE',
  AUTH_SUCCESS = 'AUTH_SUCCESS',
  RATE_LIMIT_HIT = 'RATE_LIMIT_HIT',
  WEBHOOK_SIGNATURE_INVALID = 'WEBHOOK_SIGNATURE_INVALID',
  WEBHOOK_SECRET_MISSING = 'WEBHOOK_SECRET_MISSING',
  LICENSE_VERIFY_INVALID = 'LICENSE_VERIFY_INVALID',
  LICENSE_VERIFY_EXPIRED = 'LICENSE_VERIFY_EXPIRED',
  LICENSE_VERIFY_REVOKED = 'LICENSE_VERIFY_REVOKED',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
}

export interface SecurityEvent {
  type: SecurityEventType;
  ip?: string;
  userAgent?: string;
  endpoint?: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class SecurityLoggerService {
  private readonly logger = new Logger('SecurityAudit');

  logEvent(event: SecurityEvent): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: event.type,
      ip: event.ip ?? 'unknown',
      userAgent: event.userAgent ?? 'unknown',
      endpoint: event.endpoint ?? 'unknown',
      ...event.details,
    };

    // Log at appropriate level based on event type
    switch (event.type) {
      case SecurityEventType.AUTH_FAILURE:
      case SecurityEventType.WEBHOOK_SIGNATURE_INVALID:
      case SecurityEventType.SUSPICIOUS_ACTIVITY:
        this.logger.warn(JSON.stringify(logEntry));
        break;

      case SecurityEventType.WEBHOOK_SECRET_MISSING:
        this.logger.error(JSON.stringify(logEntry));
        break;

      case SecurityEventType.AUTH_SUCCESS:
        this.logger.debug(JSON.stringify(logEntry));
        break;

      default:
        this.logger.log(JSON.stringify(logEntry));
    }
  }

  logAuthFailure(ip: string, endpoint: string, reason: string, userAgent?: string): void {
    this.logEvent({
      type: SecurityEventType.AUTH_FAILURE,
      ip,
      endpoint,
      userAgent,
      details: { reason },
    });
  }

  logWebhookSignatureInvalid(provider: string, ip: string): void {
    this.logEvent({
      type: SecurityEventType.WEBHOOK_SIGNATURE_INVALID,
      ip,
      endpoint: `/api/webhooks/${provider}`,
      details: { provider },
    });
  }

  logRateLimitHit(ip: string, endpoint: string): void {
    this.logEvent({
      type: SecurityEventType.RATE_LIMIT_HIT,
      ip,
      endpoint,
    });
  }

  logLicenseVerifyFailure(
    reason: 'invalid' | 'expired' | 'revoked',
    licenseKeyPrefix?: string
  ): void {
    const typeMap = {
      invalid: SecurityEventType.LICENSE_VERIFY_INVALID,
      expired: SecurityEventType.LICENSE_VERIFY_EXPIRED,
      revoked: SecurityEventType.LICENSE_VERIFY_REVOKED,
    };

    this.logEvent({
      type: typeMap[reason],
      details: { licenseKeyPrefix },
    });
  }

  logCriticalEvent(eventType: string, details: Record<string, unknown>): void {
    this.logger.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        eventType,
        severity: 'CRITICAL',
        ...details,
      })
    );
  }
}
