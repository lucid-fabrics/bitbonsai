import { BaseError } from './base.error';

/**
 * Error thrown when authentication is required but not provided
 */
export class UnauthorizedError extends BaseError {
  constructor(message = 'Authentication required', context?: Record<string, unknown>) {
    super(message, 401, 'UNAUTHORIZED', true, context);
  }
}

/**
 * Error thrown when user is authenticated but lacks required permissions
 */
export class ForbiddenError extends BaseError {
  constructor(
    message = 'Insufficient permissions to access this resource',
    context?: Record<string, unknown>
  ) {
    super(message, 403, 'FORBIDDEN', true, context);
  }
}

/**
 * Error thrown when license validation fails
 */
export class InvalidLicenseError extends BaseError {
  constructor(reason?: string) {
    const message = reason ? `Invalid license: ${reason}` : 'Invalid or expired license';
    super(message, 403, 'INVALID_LICENSE', true);
  }
}

/**
 * Error thrown when a feature requires a higher license tier
 */
export class FeatureNotLicensedError extends BaseError {
  constructor(featureName: string) {
    super(
      `Feature '${featureName}' is not available with your current license`,
      403,
      'FEATURE_NOT_LICENSED',
      true,
      { feature: featureName }
    );
  }
}
