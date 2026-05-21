import type { Request, Response } from 'express';
import { HttpLoggerMiddleware } from '../../logging/http-logger.middleware';
import { LoggerService } from '../../logging/logger.service';

describe('HttpLoggerMiddleware', () => {
  let middleware: HttpLoggerMiddleware;
  let mockLogger: {
    setContext: jest.Mock;
    http: jest.Mock;
    logWithData: jest.Mock;
  };

  beforeEach(() => {
    mockLogger = {
      setContext: jest.fn(),
      http: jest.fn(),
      logWithData: jest.fn(),
    };

    middleware = new HttpLoggerMiddleware(mockLogger as unknown as LoggerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  it('should set context to HTTP', () => {
    expect(mockLogger.setContext).toHaveBeenCalledWith('HTTP');
  });

  it('should log incoming request', () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/queue',
      ip: '192.168.1.100',
      headers: { 'user-agent': 'TestAgent/1.0' },
    } as unknown as Request;

    const res = {
      end: jest.fn(),
      statusCode: 200,
    } as unknown as Response;

    const next = jest.fn();

    middleware.use(req, res, next);

    expect(mockLogger.http).toHaveBeenCalledWith('Incoming request', {
      method: 'GET',
      url: '/api/queue',
      ip: '192.168.1.100',
      userAgent: 'TestAgent/1.0',
      correlationId: undefined,
    });
    expect(next).toHaveBeenCalled();
  });

  it('should use correlation ID from x-correlation-id header', () => {
    const req = {
      method: 'POST',
      originalUrl: '/api/test',
      ip: '10.0.0.1',
      headers: {
        'user-agent': 'Test',
        'x-correlation-id': 'corr-123',
      },
    } as unknown as Request;

    const res = {
      end: jest.fn(),
      statusCode: 200,
    } as unknown as Response;

    middleware.use(req, res, jest.fn());

    expect(mockLogger.http).toHaveBeenCalledWith(
      'Incoming request',
      expect.objectContaining({ correlationId: 'corr-123' })
    );
  });

  it('should use x-request-id as fallback correlation ID', () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/test',
      ip: '10.0.0.1',
      headers: {
        'user-agent': 'Test',
        'x-request-id': 'req-456',
      },
    } as unknown as Request;

    const res = {
      end: jest.fn(),
      statusCode: 200,
    } as unknown as Response;

    middleware.use(req, res, jest.fn());

    expect(mockLogger.http).toHaveBeenCalledWith(
      'Incoming request',
      expect.objectContaining({ correlationId: 'req-456' })
    );
  });

  it('should use Unknown for missing user-agent', () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/test',
      ip: '10.0.0.1',
      headers: {},
    } as unknown as Request;

    const res = {
      end: jest.fn(),
      statusCode: 200,
    } as unknown as Response;

    middleware.use(req, res, jest.fn());

    expect(mockLogger.http).toHaveBeenCalledWith(
      'Incoming request',
      expect.objectContaining({ userAgent: 'Unknown' })
    );
  });

  it('should log response completion on res.end()', () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/test',
      ip: '10.0.0.1',
      headers: { 'user-agent': 'Test' },
    } as unknown as Request;

    const originalEnd = jest.fn().mockReturnThis();
    const res = {
      end: originalEnd,
      statusCode: 200,
    } as unknown as Response;

    middleware.use(req, res, jest.fn());

    // Call the overridden end
    res.end();

    expect(mockLogger.logWithData).toHaveBeenCalledWith(
      'http',
      'Request completed',
      expect.objectContaining({
        method: 'GET',
        url: '/api/test',
        statusCode: 200,
        ip: '10.0.0.1',
      })
    );
  });

  it('should log warn level for 4xx status codes', () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/notfound',
      ip: '10.0.0.1',
      headers: { 'user-agent': 'Test' },
    } as unknown as Request;

    const originalEnd = jest.fn().mockReturnThis();
    const res = {
      end: originalEnd,
      statusCode: 404,
    } as unknown as Response;

    middleware.use(req, res, jest.fn());
    res.end();

    expect(mockLogger.logWithData).toHaveBeenCalledWith(
      'warn',
      'Request completed',
      expect.objectContaining({ statusCode: 404 })
    );
  });

  it('should log error level for 5xx status codes', () => {
    const req = {
      method: 'POST',
      originalUrl: '/api/crash',
      ip: '10.0.0.1',
      headers: { 'user-agent': 'Test' },
    } as unknown as Request;

    const originalEnd = jest.fn().mockReturnThis();
    const res = {
      end: originalEnd,
      statusCode: 500,
    } as unknown as Response;

    middleware.use(req, res, jest.fn());
    res.end();

    expect(mockLogger.logWithData).toHaveBeenCalledWith(
      'error',
      'Request completed',
      expect.objectContaining({ statusCode: 500 })
    );
  });
});
