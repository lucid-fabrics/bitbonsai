import { LoggerService } from '../../logging/logger.service';

describe('LoggerService', () => {
  let service: LoggerService;
  let mockWinstonLogger: {
    info: jest.Mock;
    error: jest.Mock;
    warn: jest.Mock;
    debug: jest.Mock;
    verbose: jest.Mock;
    http: jest.Mock;
    log: jest.Mock;
  };

  beforeEach(() => {
    mockWinstonLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      http: jest.fn(),
      log: jest.fn(),
    };

    service = new LoggerService(mockWinstonLogger as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('setContext', () => {
    it('should set context for subsequent log calls', () => {
      service.setContext('TestContext');
      service.log('test message');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('test message', {
        context: 'TestContext',
      });
    });
  });

  describe('log', () => {
    it('should call winston info with message', () => {
      service.log('test message');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('test message', {
        context: undefined,
      });
    });

    it('should use provided context over default', () => {
      service.setContext('Default');
      service.log('test message', 'Override');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('test message', {
        context: 'Override',
      });
    });

    it('should include metadata', () => {
      service.log('test message', undefined, { key: 'value' });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('test message', {
        context: undefined,
        key: 'value',
      });
    });
  });

  describe('error', () => {
    it('should call winston error with message and stack', () => {
      service.error('error occurred', 'stack trace');

      expect(mockWinstonLogger.error).toHaveBeenCalledWith('error occurred', {
        context: undefined,
        stack: 'stack trace',
      });
    });

    it('should include context when provided', () => {
      service.error('error occurred', 'stack', 'ErrorContext');

      expect(mockWinstonLogger.error).toHaveBeenCalledWith('error occurred', {
        context: 'ErrorContext',
        stack: 'stack',
      });
    });

    it('should include metadata', () => {
      service.error('error occurred', undefined, undefined, { code: 500 });

      expect(mockWinstonLogger.error).toHaveBeenCalledWith('error occurred', {
        context: undefined,
        stack: undefined,
        code: 500,
      });
    });
  });

  describe('warn', () => {
    it('should call winston warn', () => {
      service.warn('warning message');

      expect(mockWinstonLogger.warn).toHaveBeenCalledWith('warning message', {
        context: undefined,
      });
    });

    it('should include context and metadata', () => {
      service.warn('warning', 'WarnContext', { level: 'high' });

      expect(mockWinstonLogger.warn).toHaveBeenCalledWith('warning', {
        context: 'WarnContext',
        level: 'high',
      });
    });
  });

  describe('debug', () => {
    it('should call winston debug', () => {
      service.debug('debug message');

      expect(mockWinstonLogger.debug).toHaveBeenCalledWith('debug message', {
        context: undefined,
      });
    });
  });

  describe('verbose', () => {
    it('should call winston verbose', () => {
      service.verbose('verbose message');

      expect(mockWinstonLogger.verbose).toHaveBeenCalledWith('verbose message', {
        context: undefined,
      });
    });
  });

  describe('http', () => {
    it('should call winston http with context', () => {
      service.setContext('HTTP');
      service.http('incoming request', { method: 'GET', url: '/api/test' });

      expect(mockWinstonLogger.http).toHaveBeenCalledWith('incoming request', {
        context: 'HTTP',
        method: 'GET',
        url: '/api/test',
      });
    });

    it('should handle no metadata', () => {
      service.http('request');

      expect(mockWinstonLogger.http).toHaveBeenCalledWith('request', {
        context: undefined,
      });
    });
  });

  describe('logWithData', () => {
    it('should call winston log with level and data', () => {
      service.setContext('MyService');
      service.logWithData('info', 'structured log', { key: 'value', count: 42 });

      expect(mockWinstonLogger.log).toHaveBeenCalledWith('info', 'structured log', {
        context: 'MyService',
        key: 'value',
        count: 42,
      });
    });

    it('should handle error level', () => {
      service.logWithData('error', 'error log', { statusCode: 500 });

      expect(mockWinstonLogger.log).toHaveBeenCalledWith('error', 'error log', {
        context: undefined,
        statusCode: 500,
      });
    });
  });
});
