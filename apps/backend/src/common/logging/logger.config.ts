import type { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';

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
    return `${timestamp} ${level} ${contextStr} ${message}${metaStr}`;
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
    version: process.env.APP_VERSION || '0.1.0',
  },
  transports: [
    // Console transport (always enabled)
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),

    // File transports (production only)
    ...(isDevelopment
      ? []
      : [
          // Error logs
          new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 10485760, // 10MB
            maxFiles: 5,
            tailable: true,
          }),

          // Combined logs
          new winston.transports.File({
            filename: 'logs/combined.log',
            maxsize: 10485760, // 10MB
            maxFiles: 10,
            tailable: true,
          }),

          // HTTP logs
          new winston.transports.File({
            filename: 'logs/http.log',
            level: 'http',
            maxsize: 10485760, // 10MB
            maxFiles: 5,
            tailable: true,
          }),
        ]),
  ],
  exceptionHandlers: isDevelopment
    ? [new winston.transports.Console()]
    : [
        new winston.transports.File({
          filename: 'logs/exceptions.log',
          maxsize: 10485760,
          maxFiles: 3,
        }),
        new winston.transports.Console(),
      ],
  rejectionHandlers: isDevelopment
    ? [new winston.transports.Console()]
    : [
        new winston.transports.File({
          filename: 'logs/rejections.log',
          maxsize: 10485760,
          maxFiles: 3,
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
