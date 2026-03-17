import { BaseError } from './base.error';

/**
 * Error thrown when a business rule is violated
 */
export class BusinessRuleError extends BaseError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 422, 'BUSINESS_RULE_VIOLATION', true, context);
  }
}

/**
 * Error thrown when a node is offline and cannot perform operations
 */
export class NodeOfflineError extends BaseError {
  constructor(nodeId: string, nodeName?: string) {
    const name = nodeName || nodeId;
    super(`Node '${name}' is offline and cannot process jobs`, 422, 'NODE_OFFLINE', true, {
      nodeId,
      nodeName,
    });
  }
}

/**
 * Error thrown when a job cannot be assigned due to capacity
 */
export class InsufficientCapacityError extends BaseError {
  constructor(message = 'No available nodes with sufficient capacity') {
    super(message, 422, 'INSUFFICIENT_CAPACITY', true);
  }
}

/**
 * Error thrown when encoding fails
 */
export class EncodingFailedError extends BaseError {
  constructor(reason: string, context?: Record<string, unknown>) {
    super(`Encoding failed: ${reason}`, 422, 'ENCODING_FAILED', true, context);
  }
}

/**
 * Error thrown when a file cannot be accessed
 */
export class FileAccessError extends BaseError {
  constructor(filePath: string, reason?: string) {
    const message = reason
      ? `Cannot access file '${filePath}': ${reason}`
      : `Cannot access file '${filePath}'`;
    super(message, 422, 'FILE_ACCESS_ERROR', true, { filePath, reason });
  }
}

/**
 * Error thrown when storage quota is exceeded
 */
export class StorageQuotaExceededError extends BaseError {
  constructor(quota: number, currentUsage: number) {
    super(
      `Storage quota exceeded: ${currentUsage}GB / ${quota}GB`,
      422,
      'STORAGE_QUOTA_EXCEEDED',
      true,
      { quota, currentUsage }
    );
  }
}
