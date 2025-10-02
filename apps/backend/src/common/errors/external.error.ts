import { BaseError } from './base.error';

/**
 * Error thrown when an external service or dependency fails
 */
export class ExternalServiceError extends BaseError {
  constructor(service: string, reason: string, context?: Record<string, unknown>) {
    super(`External service '${service}' failed: ${reason}`, 503, 'EXTERNAL_SERVICE_ERROR', true, {
      service,
      reason,
      ...context,
    });
  }
}

/**
 * Error thrown when database operations fail
 */
export class DatabaseError extends BaseError {
  constructor(operation: string, reason: string, context?: Record<string, unknown>) {
    super(`Database ${operation} failed: ${reason}`, 500, 'DATABASE_ERROR', false, {
      operation,
      reason,
      ...context,
    });
  }
}

/**
 * Error thrown when FFmpeg operations fail
 */
export class FFmpegError extends ExternalServiceError {
  constructor(reason: string, context?: Record<string, unknown>) {
    super('FFmpeg', reason, context);
    this.errorCode = 'FFMPEG_ERROR';
  }
}

/**
 * Error thrown when network/API communication fails
 */
export class NetworkError extends ExternalServiceError {
  constructor(endpoint: string, reason: string, context?: Record<string, unknown>) {
    super(`Network request to ${endpoint}`, reason, context);
    this.errorCode = 'NETWORK_ERROR';
  }
}
