import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BaseError } from '../errors/base.error';

/**
 * Response structure for error responses
 */
interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string;
  errorCode?: string;
  context?: Record<string, unknown>;
  stack?: string;
}

/**
 * Global exception filter that catches all exceptions and formats them consistently.
 *
 * Handles:
 * - Custom BaseError instances with structured error information
 * - NestJS HttpException instances
 * - Unexpected errors with proper logging
 *
 * Features:
 * - Consistent error response format
 * - Environment-aware stack trace inclusion
 * - Correlation ID support for request tracking
 * - Detailed logging for debugging
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, errorResponse } = this.buildErrorResponse(exception, request);

    // Log the error
    this.logError(exception, request, statusCode);

    // Send response
    response.status(statusCode).json(errorResponse);
  }

  /**
   * Builds a structured error response based on the exception type
   */
  private buildErrorResponse(
    exception: unknown,
    request: Request
  ): { statusCode: number; errorResponse: ErrorResponse } {
    const timestamp = new Date().toISOString();
    const path = request.url;
    const method = request.method;
    const isDevelopment = process.env.NODE_ENV === 'development';

    // Handle custom BaseError instances
    if (exception instanceof BaseError) {
      return {
        statusCode: exception.statusCode,
        errorResponse: {
          statusCode: exception.statusCode,
          timestamp,
          path,
          method,
          message: exception.message,
          errorCode: exception.errorCode,
          context: exception.context,
          ...(isDevelopment && { stack: exception.stack }),
        },
      };
    }

    // Handle NestJS HttpException instances
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as Record<string, unknown>).message || exception.message;

      return {
        statusCode: status,
        errorResponse: {
          statusCode: status,
          timestamp,
          path,
          method,
          message: Array.isArray(message) ? message.join(', ') : String(message),
          errorCode: 'HTTP_EXCEPTION',
          ...(isDevelopment && { stack: exception.stack }),
        },
      };
    }

    // Handle unexpected errors
    const error = exception as Error;
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorResponse: {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        timestamp,
        path,
        method,
        message: isDevelopment ? error.message : 'Internal server error',
        errorCode: 'INTERNAL_SERVER_ERROR',
        ...(isDevelopment && error.stack && { stack: error.stack }),
      },
    };
  }

  /**
   * Logs error details for debugging and monitoring
   */
  private logError(exception: unknown, request: Request, statusCode: number): void {
    const { method, url, ip, headers } = request;
    const userAgent = headers['user-agent'] || 'Unknown';
    const correlationId = headers['x-correlation-id'] || headers['x-request-id'] || 'none';

    // Build context for structured logging
    const context = {
      statusCode,
      method,
      url,
      ip,
      userAgent,
      correlationId,
      timestamp: new Date().toISOString(),
    };

    // Log based on error type
    if (exception instanceof BaseError) {
      // Only log operational errors at warn level
      if (exception.isOperational) {
        this.logger.warn({
          message: exception.message,
          errorCode: exception.errorCode,
          errorContext: exception.context,
          ...context,
        });
      } else {
        // Non-operational errors are unexpected, log at error level
        this.logger.error({
          message: exception.message,
          errorCode: exception.errorCode,
          errorContext: exception.context,
          stack: exception.stack,
          ...context,
        });
      }
    } else if (exception instanceof HttpException) {
      // Log HTTP exceptions at warn level (usually client errors)
      if (statusCode >= 500) {
        this.logger.error({
          message: exception.message,
          stack: exception.stack,
          ...context,
        });
      } else {
        this.logger.warn({
          message: exception.message,
          ...context,
        });
      }
    } else {
      // Log unexpected errors at error level with full details
      const error = exception as Error;
      this.logger.error({
        message: error.message || 'Unexpected error occurred',
        stack: error.stack,
        error: String(exception),
        ...context,
      });
    }
  }
}
