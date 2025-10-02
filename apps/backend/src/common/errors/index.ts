/**
 * BitBonsai Custom Error Classes
 *
 * Centralized error handling for consistent API responses and debugging.
 * All errors extend BaseError and provide structured error information.
 */

// Base error
export { BaseError } from './base.error';

// Validation errors (400)
export {
  ValidationError,
  MissingFieldError,
  InvalidFieldError,
} from './validation.error';

// Authorization errors (401, 403)
export {
  UnauthorizedError,
  ForbiddenError,
  InvalidLicenseError,
  FeatureNotLicensedError,
} from './authorization.error';

// Not found errors (404)
export {
  NotFoundError,
  LibraryNotFoundError,
  NodeNotFoundError,
  PolicyNotFoundError,
  JobNotFoundError,
  LicenseNotFoundError,
} from './not-found.error';

// Conflict errors (409)
export {
  ConflictError,
  DuplicateResourceError,
  LibraryPathConflictError,
  NodeNameConflictError,
} from './conflict.error';

// Business rule errors (422)
export {
  BusinessRuleError,
  NodeOfflineError,
  InsufficientCapacityError,
  EncodingFailedError,
  FileAccessError,
  StorageQuotaExceededError,
} from './business.error';

// External service errors (500, 503)
export {
  ExternalServiceError,
  DatabaseError,
  FFmpegError,
  NetworkError,
} from './external.error';
