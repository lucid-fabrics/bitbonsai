import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { UserRepository } from '../../../common/repositories/user.repository';
import { AuthService } from '../../auth.service';
import type { LoginDto } from '../../dto/login.dto';
import type { RefreshTokenDto } from '../../dto/refresh-token.dto';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;

  const mockUserRepository = {
    findByUsername: jest.fn(),
    findByRefreshToken: jest.fn(),
    update: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockUser = {
    id: 'user-123',
    username: 'admin',
    email: 'admin@example.com',
    passwordHash: '$2b$10$hashedpassword',
    role: 'ADMIN',
    isActive: true,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    lastLoginAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    const loginDto: LoginDto = { username: 'admin', password: 'correct-password' };

    it('should return AuthResponseDto with tokens on valid credentials', async () => {
      mockUserRepository.findByUsername.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.sign.mockReturnValue('mock-access-token');
      mockUserRepository.update.mockResolvedValue(mockUser);

      const result = await service.login(loginDto);

      expect(result.access_token).toBe('mock-access-token');
      expect(typeof result.refresh_token).toBe('string');
      expect(result.refresh_token.length).toBeGreaterThan(0);
      expect(result.userId).toBe('user-123');
      expect(result.username).toBe('admin');
      expect(result.role).toBe('ADMIN');
    });

    it('should call userRepository.findByUsername with the provided username', async () => {
      mockUserRepository.findByUsername.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.sign.mockReturnValue('mock-access-token');
      mockUserRepository.update.mockResolvedValue(mockUser);

      await service.login(loginDto);

      expect(mockUserRepository.findByUsername).toHaveBeenCalledWith('admin');
    });

    it('should update user with refreshToken and lastLoginAt after successful login', async () => {
      mockUserRepository.findByUsername.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.sign.mockReturnValue('mock-access-token');
      mockUserRepository.update.mockResolvedValue(mockUser);

      await service.login(loginDto);

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          refreshToken: expect.any(String),
          refreshTokenExpiresAt: expect.any(Date),
          lastLoginAt: expect.any(Date),
        })
      );
    });

    it('should throw UnauthorizedException with "Invalid credentials" when user not found', async () => {
      mockUserRepository.findByUsername.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException with "Account is disabled" when user is inactive', async () => {
      mockUserRepository.findByUsername.mockResolvedValue({ ...mockUser, isActive: false });

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Account is disabled');
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException with "Invalid credentials" when password is wrong', async () => {
      mockUserRepository.findByUsername.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });
  });

  describe('refreshToken', () => {
    const refreshTokenDto: RefreshTokenDto = { refreshToken: 'valid-refresh-token' };

    it('should return new AuthResponseDto with rotated tokens on valid refresh token', async () => {
      const userWithToken = {
        ...mockUser,
        refreshToken: 'valid-refresh-token',
        refreshTokenExpiresAt: new Date(Date.now() + 86400000), // 1 day from now
      };

      mockUserRepository.findByRefreshToken.mockResolvedValue(userWithToken);
      mockJwtService.sign.mockReturnValue('new-access-token');
      mockUserRepository.update.mockResolvedValue(userWithToken);

      const result = await service.refreshToken(refreshTokenDto);

      expect(result.access_token).toBe('new-access-token');
      expect(result.refresh_token).not.toBeNull();
      expect(result.userId).toBe('user-123');
    });

    it('should rotate the refresh token (store new token in database)', async () => {
      const userWithToken = {
        ...mockUser,
        refreshToken: 'valid-refresh-token',
        refreshTokenExpiresAt: new Date(Date.now() + 86400000),
      };

      mockUserRepository.findByRefreshToken.mockResolvedValue(userWithToken);
      mockJwtService.sign.mockReturnValue('new-access-token');
      mockUserRepository.update.mockResolvedValue(userWithToken);

      await service.refreshToken(refreshTokenDto);

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          refreshToken: expect.any(String),
          refreshTokenExpiresAt: expect.any(Date),
        })
      );
    });

    it('should throw UnauthorizedException with "Invalid refresh token" when token not found', async () => {
      mockUserRepository.findByRefreshToken.mockResolvedValue(null);

      await expect(service.refreshToken(refreshTokenDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.refreshToken(refreshTokenDto)).rejects.toThrow('Invalid refresh token');
    });

    it('should throw UnauthorizedException with "Refresh token expired" when token is expired', async () => {
      const userWithExpiredToken = {
        ...mockUser,
        refreshToken: 'valid-refresh-token',
        refreshTokenExpiresAt: new Date(Date.now() - 86400000), // 1 day ago
      };

      mockUserRepository.findByRefreshToken.mockResolvedValue(userWithExpiredToken);

      await expect(service.refreshToken(refreshTokenDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.refreshToken(refreshTokenDto)).rejects.toThrow('Refresh token expired');
    });

    it('should throw UnauthorizedException with "Refresh token expired" when refreshTokenExpiresAt is null', async () => {
      const userWithNullExpiry = {
        ...mockUser,
        refreshToken: 'valid-refresh-token',
        refreshTokenExpiresAt: null,
      };

      mockUserRepository.findByRefreshToken.mockResolvedValue(userWithNullExpiry);

      await expect(service.refreshToken(refreshTokenDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.refreshToken(refreshTokenDto)).rejects.toThrow('Refresh token expired');
    });
  });

  describe('logout', () => {
    it('should nullify refreshToken and refreshTokenExpiresAt for the user', async () => {
      mockUserRepository.update.mockResolvedValue(mockUser);

      await service.logout('user-123');

      expect(mockUserRepository.update).toHaveBeenCalledWith('user-123', {
        refreshToken: null,
        refreshTokenExpiresAt: null,
      });
    });

    it('should resolve without error when called with a valid userId', async () => {
      mockUserRepository.update.mockResolvedValue(mockUser);

      await expect(service.logout('user-123')).resolves.toBeUndefined();
    });
  });

  describe('validateToken', () => {
    it('should return decoded payload for a valid token', async () => {
      const mockPayload = { userId: 'user-123', username: 'admin', role: 'ADMIN' };
      mockJwtService.verify.mockReturnValue(mockPayload);

      const result = await service.validateToken('valid-jwt-token');

      expect(result).toEqual(mockPayload);
      expect(mockJwtService.verify).toHaveBeenCalledWith('valid-jwt-token');
    });

    it('should throw UnauthorizedException with "Invalid token" when JWT verification fails', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('JsonWebTokenError');
      });

      await expect(service.validateToken('malformed-token')).rejects.toThrow(UnauthorizedException);
      await expect(service.validateToken('malformed-token')).rejects.toThrow('Invalid token');
    });

    it('should throw UnauthorizedException when token is expired', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('TokenExpiredError');
      });

      await expect(service.validateToken('expired-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('hashPassword', () => {
    it('should return a bcrypt hash of the password', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$hashed');

      const result = await service.hashPassword('my-password');

      expect(result).toBe('$2b$10$hashed');
      expect(bcrypt.hash).toHaveBeenCalledWith('my-password', 10);
    });
  });
});
