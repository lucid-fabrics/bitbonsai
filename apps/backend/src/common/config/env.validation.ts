import { Logger } from '@nestjs/common';

/**
 * Environment variables configuration interface
 */
interface EnvConfig {
  // Core settings
  NODE_ENV?: string;
  PORT?: string;

  // Database
  DATABASE_URL?: string;

  // Security
  JWT_SECRET?: string;
  ENCRYPTION_KEY?: string;

  // Multi-node
  NODE_ROLE?: string;
  MAIN_API_URL?: string;

  // License API
  LICENSE_API_URL?: string;

  // CORS
  FRONTEND_URL?: string;
  ALLOWED_ORIGINS?: string;

  // Allow other env vars
  [key: string]: string | undefined;
}

/**
 * Validates environment variables at application startup.
 *
 * This validation runs before the NestJS application is created,
 * providing early feedback on misconfiguration.
 *
 * @param config - Environment variables from process.env
 * @returns Validated config (throws on validation errors)
 */
export function envValidationSchema(config: EnvConfig): EnvConfig {
  const logger = new Logger('EnvValidation');
  const errors: string[] = [];
  const warnings: string[] = [];

  // ==========================================================================
  // REQUIRED: DATABASE_URL
  // ==========================================================================
  if (!config.DATABASE_URL) {
    errors.push(
      'DATABASE_URL is required. Example: postgresql://user:pass@localhost:5432/bitbonsai'
    );
  }

  // ==========================================================================
  // SECURITY: JWT_SECRET
  // ==========================================================================
  const isProduction = config.NODE_ENV === 'production';

  if (isProduction && !config.JWT_SECRET) {
    errors.push(
      'JWT_SECRET is required in production mode. Generate with: openssl rand -base64 32'
    );
  }

  if (config.JWT_SECRET && config.JWT_SECRET.length < 32) {
    errors.push(
      `JWT_SECRET must be at least 32 characters (current: ${config.JWT_SECRET.length}). Generate with: openssl rand -base64 32`
    );
  }

  // ==========================================================================
  // SECURITY: ENCRYPTION_KEY (optional, but validated if present)
  // ==========================================================================
  if (config.ENCRYPTION_KEY) {
    if (config.ENCRYPTION_KEY.length < 32) {
      errors.push(
        `ENCRYPTION_KEY must be at least 32 characters (current: ${config.ENCRYPTION_KEY.length}). Generate with: openssl rand -base64 32`
      );
    }

    // Validate base64 format for ENCRYPTION_KEY
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    if (!base64Regex.test(config.ENCRYPTION_KEY.replace(/\s/g, ''))) {
      warnings.push(
        'ENCRYPTION_KEY should be base64 encoded for best compatibility. Generate with: openssl rand -base64 32'
      );
    }
  }

  // ==========================================================================
  // MULTI-NODE: NODE_ROLE and MAIN_API_URL
  // ==========================================================================
  const validRoles = ['MAIN', 'LINKED'];
  if (config.NODE_ROLE && !validRoles.includes(config.NODE_ROLE)) {
    errors.push(`NODE_ROLE must be one of: ${validRoles.join(', ')} (got: ${config.NODE_ROLE})`);
  }

  if (config.NODE_ROLE === 'LINKED' && !config.MAIN_API_URL) {
    errors.push(
      'MAIN_API_URL is required when NODE_ROLE is LINKED. Example: http://192.168.1.100:3100'
    );
  }

  if (config.MAIN_API_URL) {
    try {
      new URL(config.MAIN_API_URL);
    } catch {
      errors.push(`MAIN_API_URL is not a valid URL: ${config.MAIN_API_URL}`);
    }
  }

  // ==========================================================================
  // LICENSE API URL
  // ==========================================================================
  if (config.LICENSE_API_URL) {
    try {
      new URL(config.LICENSE_API_URL);
    } catch {
      errors.push(`LICENSE_API_URL is not a valid URL: ${config.LICENSE_API_URL}`);
    }
  }

  // ==========================================================================
  // FRONTEND URL (CORS)
  // ==========================================================================
  if (config.FRONTEND_URL) {
    try {
      new URL(config.FRONTEND_URL);
    } catch {
      errors.push(`FRONTEND_URL is not a valid URL: ${config.FRONTEND_URL}`);
    }
  }

  // ==========================================================================
  // REPORT RESULTS
  // ==========================================================================
  // Log warnings
  for (const warning of warnings) {
    logger.warn(`⚠️  ${warning}`);
  }

  // Throw if any errors
  if (errors.length > 0) {
    logger.error('Environment validation failed:');
    for (const error of errors) {
      logger.error(`  ❌ ${error}`);
    }
    throw new Error(
      `Environment validation failed with ${errors.length} error(s). See logs above for details.`
    );
  }

  logger.log('✅ Environment validation passed');
  return config;
}
