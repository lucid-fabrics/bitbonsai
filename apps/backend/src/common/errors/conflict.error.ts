import { BaseError } from './base.error';

/**
 * Error thrown when a resource conflict occurs (e.g., duplicate entry)
 */
export class ConflictError extends BaseError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 409, 'CONFLICT', true, context);
  }
}

/**
 * Error thrown when trying to create a resource that already exists
 */
export class DuplicateResourceError extends BaseError {
  constructor(resource: string, field: string, value: string) {
    super(`${resource} with ${field} '${value}' already exists`, 409, 'DUPLICATE_RESOURCE', true, {
      resource,
      field,
      value,
    });
  }
}

/**
 * Error thrown when a library path is already registered
 */
export class LibraryPathConflictError extends BaseError {
  constructor(path: string) {
    super(`A library with path '${path}' already exists`, 409, 'LIBRARY_PATH_CONFLICT', true, {
      path,
    });
  }
}

/**
 * Error thrown when a node with the same name already exists
 */
export class NodeNameConflictError extends BaseError {
  constructor(name: string) {
    super(`A node with name '${name}' already exists`, 409, 'NODE_NAME_CONFLICT', true, { name });
  }
}
