import type { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';

// Use environment variable for version, fallback to default
const APP_VERSION = process.env.APP_VERSION || '1.0.0';

/**
 * Winston logger configuration for BitBonsai
 *
 * Features:
 * - JSON structured logging for production
 * - Pretty formatting for development
 * - Separate log levels for different environments
 * - File rotation for production logs
 * - Contextual metadata support
 */

const isDevelopment = process.env.NODE_ENV === 'development';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// LOW PRIORITY FIX #21: Configurable log rotation parameters
const LOG_MAX_SIZE = parseInt(process.env.LOG_MAX_SIZE || '10485760', 10); // 10MB default
const LOG_MAX_FILES_ERROR = parseInt(process.env.LOG_MAX_FILES_ERROR || '5', 10);
const LOG_MAX_FILES_COMBINED = parseInt(process.env.LOG_MAX_FILES_COMBINED || '10', 10);
const LOG_MAX_FILES_HTTP = parseInt(process.env.LOG_MAX_FILES_HTTP || '5', 10);
const LOG_MAX_FILES_EXCEPTIONS = parseInt(process.env.LOG_MAX_FILES_EXCEPTIONS || '3', 10);

/**
 * Custom format for development logs with colors and timestamps
 */
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
    const contextStr = context ? `[${context}]` : '';
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `${timestamp} ${level} ${message} ${contextStr} ${metaStr}`;
  })
);

/**
 * JSON format for production logs (machine-readable)
 */
const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/**
 * Winston logger configuration
 */
export const winstonConfig: WinstonModuleOptions = {
  level: logLevel,
  format: isDevelopment ? developmentFormat : productionFormat,
  defaultMeta: {
    service: 'bitbonsai-api',
    environment: process.env.NODE_ENV || 'development',
    version: APP_VERSION, // Read from package.json
  },
  transports: [
    // Console transport (always enabled)
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),

    // File transports (production only)
    // LOW PRIORITY FIX #21: Log rotation with configurable parameters via environment
    ...(isDevelopment
      ? []
      : [
          // Error logs (critical issues only)
          new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: LOG_MAX_SIZE,
            maxFiles: LOG_MAX_FILES_ERROR,
            tailable: true,
          }),

          // Combined logs (all levels)
          new winston.transports.File({
            filename: 'logs/combined.log',
            maxsize: LOG_MAX_SIZE,
            maxFiles: LOG_MAX_FILES_COMBINED,
            tailable: true,
          }),

          // HTTP logs (request/response tracking)
          new winston.transports.File({
            filename: 'logs/http.log',
            level: 'http',
            maxsize: LOG_MAX_SIZE,
            maxFiles: LOG_MAX_FILES_HTTP,
            tailable: true,
          }),
        ]),
  ],
  exceptionHandlers: isDevelopment
    ? [new winston.transports.Console()]
    : [
        new winston.transports.File({
          filename: 'logs/exceptions.log',
          maxsize: LOG_MAX_SIZE,
          maxFiles: LOG_MAX_FILES_EXCEPTIONS,
        }),
        new winston.transports.Console(),
      ],
  rejectionHandlers: isDevelopment
    ? [new winston.transports.Console()]
    : [
        new winston.transports.File({
          filename: 'logs/rejections.log',
          maxsize: LOG_MAX_SIZE,
          maxFiles: LOG_MAX_FILES_EXCEPTIONS,
        }),
        new winston.transports.Console(),
      ],
  exitOnError: false,
};

/**
 * Create a child logger with specific context
 * @param context - The context name (usually class name)
 */
export function createLogger(context: string): winston.Logger {
  return winston.createLogger({
    ...winstonConfig,
    defaultMeta: {
      ...winstonConfig.defaultMeta,
      context,
    },
  });
}
