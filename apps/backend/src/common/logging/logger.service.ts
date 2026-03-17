import { Injectable, LoggerService as NestLoggerService, Scope } from '@nestjs/common';
import type { Logger } from 'winston';

/**
 * Custom logger service that wraps Winston logger
 * Compatible with NestJS LoggerService interface
 */
@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService implements NestLoggerService {
  private context?: string;

  constructor(private readonly logger: Logger) {}

  /**
   * Set the context for this logger instance
   * @param context - Usually the class name
   */
  setContext(context: string): void {
    this.context = context;
  }

  /**
   * Log a message at the specified level with optional metadata
   */
  log(message: string, context?: string, meta?: Record<string, unknown>): void {
    this.logger.info(message, {
      context: context || this.context,
      ...meta,
    });
  }

  /**
   * Log an error message
   */
  error(message: string, trace?: string, context?: string, meta?: Record<string, unknown>): void {
    this.logger.error(message, {
      context: context || this.context,
      stack: trace,
      ...meta,
    });
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: string, meta?: Record<string, unknown>): void {
    this.logger.warn(message, {
      context: context || this.context,
      ...meta,
    });
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: string, meta?: Record<string, unknown>): void {
    this.logger.debug(message, {
      context: context || this.context,
      ...meta,
    });
  }

  /**
   * Log a verbose message
   */
  verbose(message: string, context?: string, meta?: Record<string, unknown>): void {
    this.logger.verbose(message, {
      context: context || this.context,
      ...meta,
    });
  }

  /**
   * Log an HTTP request
   */
  http(message: string, meta?: Record<string, unknown>): void {
    this.logger.http(message, {
      context: this.context,
      ...meta,
    });
  }

  /**
   * Log structured data (for complex objects)
   */
  logWithData(level: string, message: string, data: Record<string, unknown>): void {
    this.logger.log(level, message, {
      context: this.context,
      ...data,
    });
  }
}
