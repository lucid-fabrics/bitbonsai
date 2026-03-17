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
export class FFmpegError extends BaseError {
  constructor(reason: string, context?: Record<string, unknown>) {
    super(`External service 'FFmpeg' failed: ${reason}`, 503, 'FFMPEG_ERROR', true, {
      service: 'FFmpeg',
      reason,
      ...context,
    });
  }
}

/**
 * Error thrown when network/API communication fails
 */
export class NetworkError extends BaseError {
  constructor(endpoint: string, reason: string, context?: Record<string, unknown>) {
    super(
      `External service 'Network request to ${endpoint}' failed: ${reason}`,
      503,
      'NETWORK_ERROR',
      true,
      {
        service: `Network request to ${endpoint}`,
        endpoint,
        reason,
        ...context,
      }
    );
  }
}
