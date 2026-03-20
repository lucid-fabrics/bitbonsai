import { type ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { BaseError } from '../../../errors/base.error';
import { GlobalExceptionFilter } from '../../global-exception.filter';

// Concrete implementation of BaseError for testing
class TestOperationalError extends BaseError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 422, 'TEST_ERROR', true, context);
  }
}

class TestNonOperationalError extends BaseError {
  constructor(message: string) {
    super(message, 500, 'INTERNAL_TEST_ERROR', false);
  }
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: { status: jest.Mock; json: jest.Mock };
  let mockRequest: { url: string; method: string; ip: string; headers: Record<string, string> };
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      url: '/api/test',
      method: 'GET',
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'jest-test',
        'x-correlation-id': 'test-correlation-123',
      },
    };

    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as unknown as ArgumentsHost;

    jest.spyOn((filter as any).logger, 'log').mockImplementation();
    jest.spyOn((filter as any).logger, 'warn').mockImplementation();
    jest.spyOn((filter as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('BaseError handling', () => {
    it('should format BaseError correctly', () => {
      const error = new TestOperationalError('Something went wrong', { key: 'value' });

      filter.catch(error, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(422);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 422,
          path: '/api/test',
          method: 'GET',
          message: 'Something went wrong',
          errorCode: 'TEST_ERROR',
          context: { key: 'value' },
        })
      );
    });

    it('should log operational errors at warn level', () => {
      const error = new TestOperationalError('Expected error');

      filter.catch(error, mockHost);

      expect((filter as any).logger.warn).toHaveBeenCalled();
      expect((filter as any).logger.error).not.toHaveBeenCalled();
    });

    it('should log non-operational errors at error level', () => {
      const error = new TestNonOperationalError('Unexpected error');

      filter.catch(error, mockHost);

      expect((filter as any).logger.error).toHaveBeenCalled();
    });

    it('should include stack trace in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new TestOperationalError('Dev error');

      filter.catch(error, mockHost);

      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg).toHaveProperty('stack');

      process.env.NODE_ENV = originalEnv;
    });

    it('should not include stack trace in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new TestOperationalError('Prod error');

      filter.catch(error, mockHost);

      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('HttpException handling', () => {
    it('should format HttpException with string response', () => {
      const error = new HttpException('Not Found', HttpStatus.NOT_FOUND);

      filter.catch(error, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Not Found',
          errorCode: 'HTTP_EXCEPTION',
        })
      );
    });

    it('should format HttpException with object response', () => {
      const error = new HttpException(
        { message: 'Validation failed', statusCode: 400 },
        HttpStatus.BAD_REQUEST
      );

      filter.catch(error, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Validation failed',
        })
      );
    });

    it('should format HttpException with array message', () => {
      const error = new HttpException(
        { message: ['field1 is required', 'field2 must be a number'] },
        HttpStatus.BAD_REQUEST
      );

      filter.catch(error, mockHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'field1 is required, field2 must be a number',
        })
      );
    });

    it('should log 5xx HttpExceptions at error level', () => {
      const error = new HttpException('Server Error', HttpStatus.INTERNAL_SERVER_ERROR);

      filter.catch(error, mockHost);

      expect((filter as any).logger.error).toHaveBeenCalled();
    });

    it('should log 4xx HttpExceptions at warn level', () => {
      const error = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

      filter.catch(error, mockHost);

      expect((filter as any).logger.warn).toHaveBeenCalled();
    });
  });

  describe('unexpected error handling', () => {
    it('should handle plain Error objects', () => {
      const error = new Error('Unexpected crash');

      filter.catch(error, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          errorCode: 'INTERNAL_SERVER_ERROR',
        })
      );
    });

    it('should hide error details in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Secret internal details');

      filter.catch(error, mockHost);

      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.message).toBe('Internal server error');
      expect(jsonArg.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });

    it('should show error details in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new Error('Debug info');

      filter.catch(error, mockHost);

      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.message).toBe('Debug info');

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle non-Error exceptions', () => {
      filter.catch('string error', mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });

    it('should log unexpected errors at error level', () => {
      const error = new Error('Crash');

      filter.catch(error, mockHost);

      expect((filter as any).logger.error).toHaveBeenCalled();
    });
  });

  describe('response format', () => {
    it('should always include timestamp', () => {
      const error = new Error('Test');

      filter.catch(error, mockHost);

      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.timestamp).not.toBeNull();
      expect(new Date(jsonArg.timestamp).getTime()).not.toBeNaN();
    });

    it('should always include path and method', () => {
      const error = new Error('Test');

      filter.catch(error, mockHost);

      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.path).toBe('/api/test');
      expect(jsonArg.method).toBe('GET');
    });
  });

  describe('correlation ID support', () => {
    it('should log correlation ID from x-correlation-id header', () => {
      const error = new Error('Test');

      filter.catch(error, mockHost);

      expect((filter as any).logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'test-correlation-123',
        })
      );
    });

    it('should fall back to x-request-id', () => {
      mockRequest.headers = {
        'user-agent': 'test',
        'x-request-id': 'request-456',
      };

      const error = new Error('Test');

      filter.catch(error, mockHost);

      expect((filter as any).logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'request-456',
        })
      );
    });

    it('should use "none" when no correlation ID', () => {
      mockRequest.headers = { 'user-agent': 'test' };

      const error = new Error('Test');

      filter.catch(error, mockHost);

      expect((filter as any).logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'none',
        })
      );
    });
  });
});
