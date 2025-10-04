/**
 * BitBonsai Custom Error Classes
 *
 * Centralized error handling for consistent API responses and debugging.
 * All errors extend BaseError and provide structured error information.
 */

// Authorization errors (401, 403)
export {
  FeatureNotLicensedError,
  ForbiddenError,
  InvalidLicenseError,
  UnauthorizedError,
} from './authorization.error';
// Base error
export { BaseError } from './base.error';
// Business rule errors (422)
export {
  BusinessRuleError,
  EncodingFailedError,
  FileAccessError,
  InsufficientCapacityError,
  NodeOfflineError,
  StorageQuotaExceededError,
} from './business.error';
// Conflict errors (409)
export {
  ConflictError,
  DuplicateResourceError,
  LibraryPathConflictError,
  NodeNameConflictError,
} from './conflict.error';
// External service errors (500, 503)
export {
  DatabaseError,
  ExternalServiceError,
  FFmpegError,
  NetworkError,
} from './external.error';
// Not found errors (404)
export {
  JobNotFoundError,
  LibraryNotFoundError,
  LicenseNotFoundError,
  NodeNotFoundError,
  NotFoundError,
  PolicyNotFoundError,
} from './not-found.error';
// Validation errors (400)
export {
  InvalidFieldError,
  MissingFieldError,
  ValidationError,
} from './validation.error';
