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
export class MissingFieldError extends ValidationError {
  constructor(fieldName: string) {
    super(`Missing required field: ${fieldName}`, { field: fieldName });
    this.errorCode = 'MISSING_FIELD';
  }
}

/**
 * Error thrown when a field has an invalid value
 */
export class InvalidFieldError extends ValidationError {
  constructor(fieldName: string, reason?: string) {
    const message = reason
      ? `Invalid value for field '${fieldName}': ${reason}`
      : `Invalid value for field '${fieldName}'`;
    super(message, { field: fieldName, reason });
    this.errorCode = 'INVALID_FIELD';
  }
}
