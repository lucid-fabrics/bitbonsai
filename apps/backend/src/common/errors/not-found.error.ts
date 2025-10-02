import { BaseError } from './base.error';

/**
 * Error thrown when a requested resource is not found
 */
export class NotFoundError extends BaseError {
  constructor(resource: string, identifier?: string | number, context?: Record<string, unknown>) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;

    super(message, 404, 'NOT_FOUND', true, {
      resource,
      identifier,
      ...context,
    });
  }
}

/**
 * Specific error for library not found
 */
export class LibraryNotFoundError extends NotFoundError {
  constructor(libraryId: string) {
    super('Library', libraryId);
    this.errorCode = 'LIBRARY_NOT_FOUND';
  }
}

/**
 * Specific error for node not found
 */
export class NodeNotFoundError extends NotFoundError {
  constructor(nodeId: string) {
    super('Node', nodeId);
    this.errorCode = 'NODE_NOT_FOUND';
  }
}

/**
 * Specific error for policy not found
 */
export class PolicyNotFoundError extends NotFoundError {
  constructor(policyId: string) {
    super('Policy', policyId);
    this.errorCode = 'POLICY_NOT_FOUND';
  }
}

/**
 * Specific error for job not found
 */
export class JobNotFoundError extends NotFoundError {
  constructor(jobId: string) {
    super('Job', jobId);
    this.errorCode = 'JOB_NOT_FOUND';
  }
}

/**
 * Specific error for license not found
 */
export class LicenseNotFoundError extends NotFoundError {
  constructor(licenseKey?: string) {
    super('License', licenseKey);
    this.errorCode = 'LICENSE_NOT_FOUND';
  }
}
