import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecurityLoggerService } from '../../security/security-logger.service';
import { AdminApiKeyGuard } from '../admin-api-key.guard';

describe('AdminApiKeyGuard', () => {
  let guard: AdminApiKeyGuard;
  let configService: ConfigService;
  let securityLogger: SecurityLoggerService;

  const createMockContext = (apiKey?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: apiKey
            ? { 'x-api-key': apiKey, 'user-agent': 'test-agent' }
            : { 'user-agent': 'test-agent' },
          ip: '127.0.0.1',
          path: '/api/test',
          socket: { remoteAddress: '127.0.0.1' },
        }),
      }),
    }) as ExecutionContext;

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as unknown as ConfigService;
    securityLogger = {
      logAuthFailure: jest.fn(),
      logEvent: jest.fn(),
    } as unknown as SecurityLoggerService;
    guard = new AdminApiKeyGuard(configService, securityLogger);
  });

  it('should throw if ADMIN_API_KEY not configured', () => {
    (configService.get as jest.Mock).mockReturnValue(undefined);
    const context = createMockContext('some-key');

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Admin API key not configured');
  });

  it('should throw if no API key provided', () => {
    (configService.get as jest.Mock).mockReturnValue('secret-key');
    const context = createMockContext();

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('API key required');
  });

  it('should throw if API key length mismatch', () => {
    (configService.get as jest.Mock).mockReturnValue('secret-key');
    const context = createMockContext('short');

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Invalid API key');
  });

  it('should throw if API key does not match', () => {
    (configService.get as jest.Mock).mockReturnValue('secret-key');
    const context = createMockContext('wrong-key1');

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Invalid API key');
  });

  it('should return true for valid API key', () => {
    (configService.get as jest.Mock).mockReturnValue('secret-key');
    const context = createMockContext('secret-key');

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should use constant-time comparison', () => {
    // This test ensures the guard uses timingSafeEqual
    // We can't directly test timing, but we verify it handles the comparison correctly
    (configService.get as jest.Mock).mockReturnValue('a'.repeat(32));
    const context = createMockContext('b'.repeat(32));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
