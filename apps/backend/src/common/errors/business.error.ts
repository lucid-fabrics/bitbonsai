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
export class NodeOfflineError extends BusinessRuleError {
  constructor(nodeId: string, nodeName?: string) {
    const name = nodeName || nodeId;
    super(`Node '${name}' is offline and cannot process jobs`, { nodeId, nodeName });
    this.errorCode = 'NODE_OFFLINE';
  }
}

/**
 * Error thrown when a job cannot be assigned due to capacity
 */
export class InsufficientCapacityError extends BusinessRuleError {
  constructor(message = 'No available nodes with sufficient capacity') {
    super(message);
    this.errorCode = 'INSUFFICIENT_CAPACITY';
  }
}

/**
 * Error thrown when encoding fails
 */
export class EncodingFailedError extends BusinessRuleError {
  constructor(reason: string, context?: Record<string, unknown>) {
    super(`Encoding failed: ${reason}`, context);
    this.errorCode = 'ENCODING_FAILED';
  }
}

/**
 * Error thrown when a file cannot be accessed
 */
export class FileAccessError extends BusinessRuleError {
  constructor(filePath: string, reason?: string) {
    const message = reason
      ? `Cannot access file '${filePath}': ${reason}`
      : `Cannot access file '${filePath}'`;
    super(message, { filePath, reason });
    this.errorCode = 'FILE_ACCESS_ERROR';
  }
}

/**
 * Error thrown when storage quota is exceeded
 */
export class StorageQuotaExceededError extends BusinessRuleError {
  constructor(quota: number, currentUsage: number) {
    super(`Storage quota exceeded: ${currentUsage}GB / ${quota}GB`, { quota, currentUsage });
    this.errorCode = 'STORAGE_QUOTA_EXCEEDED';
  }
}
