import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type JwtPayload, JwtStrategy } from '../../strategies/jwt.strategy';

describe('JwtStrategy', () => {
  const createConfigService = (jwtSecret?: string): ConfigService => {
    return {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return jwtSecret;
        return undefined;
      }),
    } as unknown as ConfigService;
  };

  describe('constructor', () => {
    it('should create strategy with valid JWT_SECRET', () => {
      const configService = createConfigService('a-valid-secret-that-is-long-enough');

      const strategy = new JwtStrategy(configService);

      expect(strategy).toBeDefined();
    });

    it('should throw error when JWT_SECRET is not set', () => {
      const configService = createConfigService(undefined);

      expect(() => new JwtStrategy(configService)).toThrow(
        'CRITICAL: JWT_SECRET environment variable is required and must be set'
      );
    });
  });

  describe('validate', () => {
    let strategy: JwtStrategy;

    beforeEach(() => {
      const configService = createConfigService('test-secret-for-validation-purposes');
      strategy = new JwtStrategy(configService);
    });

    it('should return user data for valid payload', async () => {
      const payload: JwtPayload = { sub: 'user-123', username: 'admin' };

      const result = await strategy.validate(payload);

      expect(result).toEqual({ userId: 'user-123', username: 'admin' });
    });

    it('should throw UnauthorizedException for missing sub', async () => {
      const payload = { sub: '', username: 'admin' } as JwtPayload;

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(payload)).rejects.toThrow('Invalid token payload');
    });

    it('should throw UnauthorizedException for missing username', async () => {
      const payload = { sub: 'user-123', username: '' } as JwtPayload;

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(payload)).rejects.toThrow('Invalid token payload');
    });

    it('should throw UnauthorizedException for null sub', async () => {
      const payload = { sub: null, username: 'admin' } as unknown as JwtPayload;

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for null username', async () => {
      const payload = { sub: 'user-123', username: null } as unknown as JwtPayload;

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });
  });
});
