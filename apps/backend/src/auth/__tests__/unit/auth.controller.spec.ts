import { Test, type TestingModule } from '@nestjs/testing';
import { AuthController } from '../../auth.controller';
import { AuthService } from '../../auth.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    login: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should return auth response on successful login', async () => {
      const authResponse = {
        accessToken: 'jwt-token-123',
        refreshToken: 'refresh-token-456',
        expiresIn: 3600,
      };
      mockAuthService.login.mockResolvedValue(authResponse);

      const result = await controller.login({ username: 'admin', password: 'pass123' });

      expect(result).toEqual(authResponse);
      expect(mockAuthService.login).toHaveBeenCalledWith({
        username: 'admin',
        password: 'pass123',
      });
    });

    it('should propagate auth errors', async () => {
      mockAuthService.login.mockRejectedValue(new Error('Invalid credentials'));

      await expect(controller.login({ username: 'admin', password: 'wrong' })).rejects.toThrow(
        'Invalid credentials'
      );
    });
  });

  describe('refreshToken', () => {
    it('should return new tokens on valid refresh', async () => {
      const authResponse = {
        accessToken: 'new-jwt-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
      };
      mockAuthService.refreshToken.mockResolvedValue(authResponse);

      const result = await controller.refreshToken({ refreshToken: 'old-refresh-token' });

      expect(result).toEqual(authResponse);
      expect(mockAuthService.refreshToken).toHaveBeenCalledWith({
        refreshToken: 'old-refresh-token',
      });
    });

    it('should propagate errors for expired token', async () => {
      mockAuthService.refreshToken.mockRejectedValue(new Error('Token expired'));

      await expect(controller.refreshToken({ refreshToken: 'expired-token' })).rejects.toThrow(
        'Token expired'
      );
    });
  });

  describe('logout', () => {
    it('should call authService.logout with userId', async () => {
      mockAuthService.logout.mockResolvedValue(undefined);

      const req = { user: { userId: 'user-1' } };
      await controller.logout(req);

      expect(mockAuthService.logout).toHaveBeenCalledWith('user-1');
    });

    it('should propagate errors', async () => {
      mockAuthService.logout.mockRejectedValue(new Error('Logout failed'));

      const req = { user: { userId: 'user-1' } };
      await expect(controller.logout(req)).rejects.toThrow('Logout failed');
    });
  });
});
