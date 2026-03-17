import { BaseError } from './base.error';

/**
 * Error thrown when request validation fails
 */
export class ValidationError extends BaseError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', true, context);
  }
}

/**
 * Error thrown when a required field is missing
 */
export class MissingFieldError extends BaseError {
  constructor(fieldName: string) {
    super(`Missing required field: ${fieldName}`, 400, 'MISSING_FIELD', true, { field: fieldName });
  }
}

/**
 * Error thrown when a field has an invalid value
 */
export class InvalidFieldError extends BaseError {
  constructor(fieldName: string, reason?: string) {
    const message = reason
      ? `Invalid value for field '${fieldName}': ${reason}`
      : `Invalid value for field '${fieldName}'`;
    super(message, 400, 'INVALID_FIELD', true, { field: fieldName, reason });
  }
}
