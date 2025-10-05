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
export class LibraryNotFoundError extends BaseError {
  constructor(libraryId: string) {
    super(`Library with identifier '${libraryId}' not found`, 404, 'LIBRARY_NOT_FOUND', true, {
      resource: 'Library',
      identifier: libraryId,
    });
  }
}

/**
 * Specific error for node not found
 */
export class NodeNotFoundError extends BaseError {
  constructor(nodeId: string) {
    super(`Node with identifier '${nodeId}' not found`, 404, 'NODE_NOT_FOUND', true, {
      resource: 'Node',
      identifier: nodeId,
    });
  }
}

/**
 * Specific error for policy not found
 */
export class PolicyNotFoundError extends BaseError {
  constructor(policyId: string) {
    super(`Policy with identifier '${policyId}' not found`, 404, 'POLICY_NOT_FOUND', true, {
      resource: 'Policy',
      identifier: policyId,
    });
  }
}

/**
 * Specific error for job not found
 */
export class JobNotFoundError extends BaseError {
  constructor(jobId: string) {
    super(`Job with identifier '${jobId}' not found`, 404, 'JOB_NOT_FOUND', true, {
      resource: 'Job',
      identifier: jobId,
    });
  }
}

/**
 * Specific error for license not found
 */
export class LicenseNotFoundError extends BaseError {
  constructor(licenseKey?: string) {
    const message = licenseKey
      ? `License with identifier '${licenseKey}' not found`
      : 'License not found';
    super(message, 404, 'LICENSE_NOT_FOUND', true, { resource: 'License', identifier: licenseKey });
  }
}
