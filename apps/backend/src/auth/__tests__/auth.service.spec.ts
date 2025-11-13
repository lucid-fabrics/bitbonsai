import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import { LoginDto } from '../dto/login.dto';

describe('AuthService', () => {
  let service: AuthService;
  let _jwtService: JwtService;
  let _configService: ConfigService;
  let _prisma: PrismaService;

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    _jwtService = module.get<JwtService>(JwtService);
    _configService = module.get<ConfigService>(ConfigService);
    _prisma = module.get<PrismaService>(PrismaService);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('should return access token for valid credentials', async () => {
      const loginDto: LoginDto = {
        username: 'admin',
        password: 'test-password',
      };

      mockConfigService.get
        .mockReturnValueOnce('admin') // ADMIN_USERNAME
        .mockReturnValueOnce('test-password'); // ADMIN_PASSWORD

      mockJwtService.sign.mockReturnValue('mock-jwt-token');

      const result = await service.login(loginDto);

      expect(result).toEqual({
        access_token: 'mock-jwt-token',
      });
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        username: 'admin',
        sub: 'admin',
      });
    });

    it('should throw UnauthorizedException for invalid username', async () => {
      const loginDto: LoginDto = {
        username: 'wrong-user',
        password: 'test-password',
      };

      mockConfigService.get
        .mockReturnValueOnce('admin') // ADMIN_USERNAME
        .mockReturnValueOnce('test-password'); // ADMIN_PASSWORD

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      const loginDto: LoginDto = {
        username: 'admin',
        password: 'wrong-password',
      };

      mockConfigService.get
        .mockReturnValueOnce('admin') // ADMIN_USERNAME
        .mockReturnValueOnce('test-password'); // ADMIN_PASSWORD

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });

    it('should use default credentials if env vars not set', async () => {
      const loginDto: LoginDto = {
        username: 'admin',
        password: 'change-me-in-production',
      };

      mockConfigService.get
        .mockReturnValueOnce(undefined) // ADMIN_USERNAME (undefined)
        .mockReturnValueOnce(undefined); // ADMIN_PASSWORD (undefined)

      mockJwtService.sign.mockReturnValue('mock-jwt-token');

      const result = await service.login(loginDto);

      expect(result).toEqual({
        access_token: 'mock-jwt-token',
      });
    });
  });

  describe('validateToken', () => {
    it('should return payload for valid token', async () => {
      const mockPayload = {
        sub: 'admin',
        username: 'admin',
        iat: 1234567890,
        exp: 1234567990,
      };

      mockJwtService.verify.mockReturnValue(mockPayload);

      const result = await service.validateToken('valid-token');

      expect(result).toEqual(mockPayload);
      expect(mockJwtService.verify).toHaveBeenCalledWith('valid-token');
    });

    it('should throw UnauthorizedException for invalid token', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(service.validateToken('invalid-token')).rejects.toThrow(UnauthorizedException);
      await expect(service.validateToken('invalid-token')).rejects.toThrow('Invalid token');
    });

    it('should throw UnauthorizedException for expired token', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Token expired');
      });

      await expect(service.validateToken('expired-token')).rejects.toThrow(UnauthorizedException);
    });
  });
});
