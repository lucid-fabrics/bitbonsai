import {
  BaseError,
  BusinessRuleError,
  ConflictError,
  DatabaseError,
  DuplicateResourceError,
  EncodingFailedError,
  ExternalServiceError,
  FeatureNotLicensedError,
  FFmpegError,
  FileAccessError,
  ForbiddenError,
  InsufficientCapacityError,
  InvalidFieldError,
  InvalidLicenseError,
  JobNotFoundError,
  LibraryNotFoundError,
  LibraryPathConflictError,
  LicenseNotFoundError,
  MissingFieldError,
  NetworkError,
  NodeNameConflictError,
  NodeNotFoundError,
  NodeOfflineError,
  NotFoundError,
  PolicyNotFoundError,
  StorageQuotaExceededError,
  UnauthorizedError,
  ValidationError,
} from '../../index';

// Concrete BaseError for testing abstract class
class TestError extends BaseError {
  constructor(
    message: string,
    statusCode = 500,
    errorCode = 'TEST',
    isOperational = true,
    context?: Record<string, unknown>
  ) {
    super(message, statusCode, errorCode, isOperational, context);
  }
}

describe('Custom Error Classes', () => {
  describe('BaseError', () => {
    it('should set all properties correctly', () => {
      const error = new TestError('Test message', 400, 'TEST_CODE', true, { key: 'val' });

      expect(error.message).toBe('Test message');
      expect(error.statusCode).toBe(400);
      expect(error.errorCode).toBe('TEST_CODE');
      expect(error.isOperational).toBe(true);
      expect(error.context).toEqual({ key: 'val' });
      expect(error.name).toBe('TestError');
      expect(error.stack).toBeDefined();
    });

    it('should default isOperational to true', () => {
      const error = new TestError('Test');

      expect(error.isOperational).toBe(true);
    });

    it('should be an instance of Error', () => {
      const error = new TestError('Test');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(BaseError);
    });

    it('should serialize to JSON correctly', () => {
      const error = new TestError('Test', 422, 'CODE', true, { detail: 'info' });
      const json = error.toJSON();

      expect(json).toEqual({
        name: 'TestError',
        message: 'Test',
        errorCode: 'CODE',
        statusCode: 422,
        context: { detail: 'info' },
      });
    });

    it('should serialize without context', () => {
      const error = new TestError('Test');
      const json = error.toJSON();

      expect(json.context).toBeUndefined();
    });
  });

  describe('Authorization Errors', () => {
    it('should create UnauthorizedError with defaults', () => {
      const error = new UnauthorizedError();

      expect(error.statusCode).toBe(401);
      expect(error.errorCode).toBe('UNAUTHORIZED');
      expect(error.message).toBe('Authentication required');
    });

    it('should create UnauthorizedError with custom message', () => {
      const error = new UnauthorizedError('Token expired');

      expect(error.message).toBe('Token expired');
    });

    it('should create ForbiddenError', () => {
      const error = new ForbiddenError();

      expect(error.statusCode).toBe(403);
      expect(error.errorCode).toBe('FORBIDDEN');
    });

    it('should create InvalidLicenseError', () => {
      const error = new InvalidLicenseError('expired');

      expect(error.statusCode).toBe(403);
      expect(error.errorCode).toBe('INVALID_LICENSE');
      expect(error.message).toBe('Invalid license: expired');
    });

    it('should create InvalidLicenseError without reason', () => {
      const error = new InvalidLicenseError();

      expect(error.message).toBe('Invalid or expired license');
    });

    it('should create FeatureNotLicensedError', () => {
      const error = new FeatureNotLicensedError('multi-node');

      expect(error.statusCode).toBe(403);
      expect(error.errorCode).toBe('FEATURE_NOT_LICENSED');
      expect(error.context).toEqual({ feature: 'multi-node' });
    });
  });

  describe('Business Rule Errors', () => {
    it('should create BusinessRuleError', () => {
      const error = new BusinessRuleError('Cannot delete active library');

      expect(error.statusCode).toBe(422);
      expect(error.errorCode).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('should create NodeOfflineError', () => {
      const error = new NodeOfflineError('node-1', 'Worker Node');

      expect(error.statusCode).toBe(422);
      expect(error.errorCode).toBe('NODE_OFFLINE');
      expect(error.message).toContain('Worker Node');
      expect(error.context).toEqual({ nodeId: 'node-1', nodeName: 'Worker Node' });
    });

    it('should create NodeOfflineError without name', () => {
      const error = new NodeOfflineError('node-1');

      expect(error.message).toContain('node-1');
    });

    it('should create InsufficientCapacityError', () => {
      const error = new InsufficientCapacityError();

      expect(error.statusCode).toBe(422);
      expect(error.errorCode).toBe('INSUFFICIENT_CAPACITY');
    });

    it('should create EncodingFailedError', () => {
      const error = new EncodingFailedError('FFmpeg crash', { exitCode: -1 });

      expect(error.statusCode).toBe(422);
      expect(error.errorCode).toBe('ENCODING_FAILED');
      expect(error.context).toEqual({ exitCode: -1 });
    });

    it('should create FileAccessError', () => {
      const error = new FileAccessError('/media/video.mkv', 'Permission denied');

      expect(error.statusCode).toBe(422);
      expect(error.errorCode).toBe('FILE_ACCESS_ERROR');
      expect(error.context).toEqual({ filePath: '/media/video.mkv', reason: 'Permission denied' });
    });

    it('should create FileAccessError without reason', () => {
      const error = new FileAccessError('/media/video.mkv');

      expect(error.message).toContain('/media/video.mkv');
    });

    it('should create StorageQuotaExceededError', () => {
      const error = new StorageQuotaExceededError(100, 150);

      expect(error.statusCode).toBe(422);
      expect(error.errorCode).toBe('STORAGE_QUOTA_EXCEEDED');
      expect(error.context).toEqual({ quota: 100, currentUsage: 150 });
    });
  });

  describe('Conflict Errors', () => {
    it('should create ConflictError', () => {
      const error = new ConflictError('Resource conflict');

      expect(error.statusCode).toBe(409);
      expect(error.errorCode).toBe('CONFLICT');
    });

    it('should create DuplicateResourceError', () => {
      const error = new DuplicateResourceError('Library', 'path', '/media/movies');

      expect(error.statusCode).toBe(409);
      expect(error.errorCode).toBe('DUPLICATE_RESOURCE');
      expect(error.context).toEqual({ resource: 'Library', field: 'path', value: '/media/movies' });
    });

    it('should create LibraryPathConflictError', () => {
      const error = new LibraryPathConflictError('/media/tv');

      expect(error.statusCode).toBe(409);
      expect(error.errorCode).toBe('LIBRARY_PATH_CONFLICT');
    });

    it('should create NodeNameConflictError', () => {
      const error = new NodeNameConflictError('Worker-1');

      expect(error.statusCode).toBe(409);
      expect(error.errorCode).toBe('NODE_NAME_CONFLICT');
    });
  });

  describe('External Service Errors', () => {
    it('should create ExternalServiceError', () => {
      const error = new ExternalServiceError('Plex', 'Connection refused');

      expect(error.statusCode).toBe(503);
      expect(error.errorCode).toBe('EXTERNAL_SERVICE_ERROR');
      expect(error.context).toEqual(
        expect.objectContaining({ service: 'Plex', reason: 'Connection refused' })
      );
    });

    it('should create DatabaseError (non-operational)', () => {
      const error = new DatabaseError('insert', 'Unique constraint');

      expect(error.statusCode).toBe(500);
      expect(error.errorCode).toBe('DATABASE_ERROR');
      expect(error.isOperational).toBe(false);
    });

    it('should create FFmpegError', () => {
      const error = new FFmpegError('Segfault');

      expect(error.statusCode).toBe(503);
      expect(error.errorCode).toBe('FFMPEG_ERROR');
    });

    it('should create NetworkError', () => {
      const error = new NetworkError('https://api.example.com', 'ECONNREFUSED');

      expect(error.statusCode).toBe(503);
      expect(error.errorCode).toBe('NETWORK_ERROR');
      expect(error.context).toEqual(
        expect.objectContaining({ endpoint: 'https://api.example.com' })
      );
    });
  });

  describe('Not Found Errors', () => {
    it('should create NotFoundError with identifier', () => {
      const error = new NotFoundError('User', '123');

      expect(error.statusCode).toBe(404);
      expect(error.errorCode).toBe('NOT_FOUND');
      expect(error.message).toBe("User with identifier '123' not found");
    });

    it('should create NotFoundError without identifier', () => {
      const error = new NotFoundError('Settings');

      expect(error.message).toBe('Settings not found');
    });

    it('should create LibraryNotFoundError', () => {
      const error = new LibraryNotFoundError('lib-1');

      expect(error.errorCode).toBe('LIBRARY_NOT_FOUND');
    });

    it('should create NodeNotFoundError', () => {
      const error = new NodeNotFoundError('node-1');

      expect(error.errorCode).toBe('NODE_NOT_FOUND');
    });

    it('should create PolicyNotFoundError', () => {
      const error = new PolicyNotFoundError('pol-1');

      expect(error.errorCode).toBe('POLICY_NOT_FOUND');
    });

    it('should create JobNotFoundError', () => {
      const error = new JobNotFoundError('job-1');

      expect(error.errorCode).toBe('JOB_NOT_FOUND');
    });

    it('should create LicenseNotFoundError', () => {
      const error = new LicenseNotFoundError('key-123');

      expect(error.errorCode).toBe('LICENSE_NOT_FOUND');
    });

    it('should create LicenseNotFoundError without key', () => {
      const error = new LicenseNotFoundError();

      expect(error.message).toBe('License not found');
    });
  });

  describe('Validation Errors', () => {
    it('should create ValidationError', () => {
      const error = new ValidationError('Invalid input');

      expect(error.statusCode).toBe(400);
      expect(error.errorCode).toBe('VALIDATION_ERROR');
    });

    it('should create MissingFieldError', () => {
      const error = new MissingFieldError('name');

      expect(error.statusCode).toBe(400);
      expect(error.errorCode).toBe('MISSING_FIELD');
      expect(error.context).toEqual({ field: 'name' });
    });

    it('should create InvalidFieldError', () => {
      const error = new InvalidFieldError('port', 'must be between 1-65535');

      expect(error.statusCode).toBe(400);
      expect(error.errorCode).toBe('INVALID_FIELD');
    });

    it('should create InvalidFieldError without reason', () => {
      const error = new InvalidFieldError('email');

      expect(error.message).toContain('email');
    });
  });
});
