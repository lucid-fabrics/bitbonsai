import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { LoggerService } from './logger.service';

/**
 * Middleware for logging HTTP requests and responses
 *
 * Logs:
 * - Request method, URL, IP, user agent
 * - Response status code and time
 * - Request and correlation IDs for tracing
 */
@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext('HTTP');
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    const { method, originalUrl, ip, headers } = req;
    const userAgent = headers['user-agent'] || 'Unknown';
    const correlationId = headers['x-correlation-id'] || headers['x-request-id'];

    // Log incoming request
    this.logger.http('Incoming request', {
      method,
      url: originalUrl,
      ip,
      userAgent,
      correlationId,
    });

    // Override res.end to log response
    const originalEnd = res.end.bind(res);
    const logger = this.logger;
    res.end = function (this: Response, ...args: any[]): Response {
      const responseTime = Date.now() - startTime;
      const { statusCode } = res;

      // Determine log level based on status code
      const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'http';

      logger.logWithData(level, 'Request completed', {
        method,
        url: originalUrl,
        statusCode,
        responseTime: `${responseTime}ms`,
        ip,
        userAgent,
        correlationId,
      });

      return originalEnd(...args) as Response;
    };

    next();
  }
}
