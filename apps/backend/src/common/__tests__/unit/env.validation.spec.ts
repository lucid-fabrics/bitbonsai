import { envValidationSchema } from '../../config/env.validation';

describe('envValidationSchema', () => {
  // Suppress logger output during tests
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const validConfig = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/bitbonsai',
    JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
  };

  describe('DATABASE_URL', () => {
    it('should pass with valid DATABASE_URL', () => {
      const result = envValidationSchema({ ...validConfig });
      expect(result.DATABASE_URL).toBe(validConfig.DATABASE_URL);
    });

    it('should throw when DATABASE_URL is missing', () => {
      expect(() => envValidationSchema({ JWT_SECRET: validConfig.JWT_SECRET })).toThrow(
        /validation failed/i
      );
    });
  });

  describe('JWT_SECRET', () => {
    it('should pass with valid JWT_SECRET', () => {
      const result = envValidationSchema({ ...validConfig });
      expect(result.JWT_SECRET).toBe(validConfig.JWT_SECRET);
    });

    it('should throw in production when JWT_SECRET is missing', () => {
      expect(() =>
        envValidationSchema({
          DATABASE_URL: validConfig.DATABASE_URL,
          NODE_ENV: 'production',
        })
      ).toThrow(/validation failed/i);
    });

    it('should throw when JWT_SECRET is too short', () => {
      expect(() =>
        envValidationSchema({
          DATABASE_URL: validConfig.DATABASE_URL,
          JWT_SECRET: 'short',
        })
      ).toThrow(/validation failed/i);
    });

    it('should pass in development without JWT_SECRET', () => {
      const result = envValidationSchema({
        DATABASE_URL: validConfig.DATABASE_URL,
        NODE_ENV: 'development',
      });
      expect(result.DATABASE_URL).toBe(validConfig.DATABASE_URL);
    });
  });

  describe('ENCRYPTION_KEY', () => {
    it('should pass with valid ENCRYPTION_KEY', () => {
      const result = envValidationSchema({
        ...validConfig,
        ENCRYPTION_KEY: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=',
      });
      expect(result.ENCRYPTION_KEY).toBe('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=');
    });

    it('should throw when ENCRYPTION_KEY is too short', () => {
      expect(() =>
        envValidationSchema({
          ...validConfig,
          ENCRYPTION_KEY: 'short',
        })
      ).toThrow(/validation failed/i);
    });
  });

  describe('NODE_ROLE', () => {
    it('should pass with MAIN role', () => {
      const result = envValidationSchema({ ...validConfig, NODE_ROLE: 'MAIN' });
      expect(result.NODE_ROLE).toBe('MAIN');
    });

    it('should pass with LINKED role and MAIN_API_URL', () => {
      const result = envValidationSchema({
        ...validConfig,
        NODE_ROLE: 'LINKED',
        MAIN_API_URL: 'http://192.168.1.100:3100',
      });
      expect(result.NODE_ROLE).toBe('LINKED');
    });

    it('should throw for invalid NODE_ROLE', () => {
      expect(() => envValidationSchema({ ...validConfig, NODE_ROLE: 'INVALID' })).toThrow(
        /validation failed/i
      );
    });

    it('should throw when LINKED role lacks MAIN_API_URL', () => {
      expect(() => envValidationSchema({ ...validConfig, NODE_ROLE: 'LINKED' })).toThrow(
        /validation failed/i
      );
    });
  });

  describe('URL validations', () => {
    it('should pass with valid MAIN_API_URL', () => {
      const result = envValidationSchema({
        ...validConfig,
        MAIN_API_URL: 'http://192.168.1.100:3100',
      });
      expect(result.MAIN_API_URL).toBe('http://192.168.1.100:3100');
    });

    it('should throw for invalid MAIN_API_URL', () => {
      expect(() => envValidationSchema({ ...validConfig, MAIN_API_URL: 'not-a-url' })).toThrow(
        /validation failed/i
      );
    });

    it('should throw for invalid LICENSE_API_URL', () => {
      expect(() => envValidationSchema({ ...validConfig, LICENSE_API_URL: 'not-a-url' })).toThrow(
        /validation failed/i
      );
    });

    it('should throw for invalid FRONTEND_URL', () => {
      expect(() => envValidationSchema({ ...validConfig, FRONTEND_URL: 'not-a-url' })).toThrow(
        /validation failed/i
      );
    });

    it('should pass with valid LICENSE_API_URL', () => {
      const result = envValidationSchema({
        ...validConfig,
        LICENSE_API_URL: 'https://api.bitbonsai.app',
      });
      expect(result.LICENSE_API_URL).toBe('https://api.bitbonsai.app');
    });

    it('should pass with valid FRONTEND_URL', () => {
      const result = envValidationSchema({
        ...validConfig,
        FRONTEND_URL: 'http://localhost:4200',
      });
      expect(result.FRONTEND_URL).toBe('http://localhost:4200');
    });
  });

  describe('return value', () => {
    it('should return the config object on success', () => {
      const config = { ...validConfig, EXTRA: 'value' };
      const result = envValidationSchema(config);
      expect(result).toEqual(config);
    });
  });
});
