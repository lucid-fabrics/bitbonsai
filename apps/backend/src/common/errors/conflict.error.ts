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
export class DuplicateResourceError extends ConflictError {
  constructor(resource: string, field: string, value: string) {
    super(`${resource} with ${field} '${value}' already exists`, {
      resource,
      field,
      value,
    });
    this.errorCode = 'DUPLICATE_RESOURCE';
  }
}

/**
 * Error thrown when a library path is already registered
 */
export class LibraryPathConflictError extends ConflictError {
  constructor(path: string) {
    super(`A library with path '${path}' already exists`, { path });
    this.errorCode = 'LIBRARY_PATH_CONFLICT';
  }
}

/**
 * Error thrown when a node with the same name already exists
 */
export class NodeNameConflictError extends ConflictError {
  constructor(name: string) {
    super(`A node with name '${name}' already exists`, { name });
    this.errorCode = 'NODE_NAME_CONFLICT';
  }
}
