import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

/**
 * AuthService
 *
 * Secure authentication service with:
 * - bcrypt password hashing (10 rounds)
 * - JWT access tokens (1 hour expiry)
 * - Refresh tokens (7 day expiry)
 * - Secure token rotation
 * - Database-backed user management
 *
 * SECURITY: Hardcoded credentials removed - uses database User model
 */
@Injectable()
export class AuthService {
  // Security: bcrypt rounds (10 is recommended for production)
  private readonly BCRYPT_ROUNDS = 10;

  // Token expiration times
  private readonly ACCESS_TOKEN_EXPIRY = '1h';

  constructor(
    private readonly jwtService: JwtService,
    readonly _configService: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Authenticate user with username/password
   *
   * SECURITY FEATURES:
   * - Validates against database User model (no hardcoded credentials)
   * - Uses bcrypt for password comparison (constant-time comparison)
   * - Checks if user is active
   * - Updates last login timestamp
   * - Generates both access and refresh tokens
   *
   * @param loginDto Username and password
   * @returns Access token, refresh token, and user info
   * @throws UnauthorizedException if credentials are invalid or user is inactive
   */
  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    // Find user by username
    const user = await this.prisma.user.findUnique({
      where: { username: loginDto.username },
    });

    // Security: Use generic error message to prevent username enumeration
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Security: Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    // Security: bcrypt password comparison (constant-time)
    const isPasswordValid = await bcrypt.compare(loginDto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate tokens
    const { accessToken, refreshToken } = await this.generateTokens(
      user.id,
      user.username,
      user.role
    );

    // Store refresh token in database with expiry
    const refreshTokenExpiry = new Date();
    refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 7); // 7 days

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken,
        refreshTokenExpiresAt: refreshTokenExpiry,
        lastLoginAt: new Date(),
      },
    });

    return new AuthResponseDto(accessToken, refreshToken, user.id, user.username, user.role);
  }

  /**
   * Refresh access token using refresh token
   *
   * SECURITY FEATURES:
   * - Validates refresh token against database
   * - Checks expiration
   * - Rotates refresh token (generates new one)
   * - Invalidates old refresh token
   *
   * @param refreshTokenDto Refresh token
   * @returns New access token and refresh token
   * @throws UnauthorizedException if refresh token is invalid or expired
   */
  async refreshToken(refreshTokenDto: RefreshTokenDto): Promise<AuthResponseDto> {
    // Find user by refresh token
    const user = await this.prisma.user.findFirst({
      where: {
        refreshToken: refreshTokenDto.refreshToken,
        isActive: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Check if refresh token is expired
    if (!user.refreshTokenExpiresAt || user.refreshTokenExpiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Generate new tokens (token rotation)
    const { accessToken, refreshToken } = await this.generateTokens(
      user.id,
      user.username,
      user.role
    );

    // Update refresh token in database
    const refreshTokenExpiry = new Date();
    refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 7); // 7 days

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken,
        refreshTokenExpiresAt: refreshTokenExpiry,
      },
    });

    return new AuthResponseDto(accessToken, refreshToken, user.id, user.username, user.role);
  }

  /**
   * Logout user (invalidate refresh token)
   *
   * @param userId User ID
   */
  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        refreshToken: null,
        refreshTokenExpiresAt: null,
      },
    });
  }

  /**
   * Validate JWT access token
   *
   * @param token JWT access token
   * @returns Decoded token payload
   * @throws UnauthorizedException if token is invalid
   */
  async validateToken(token: string): Promise<{ userId: string; username: string; role: string }> {
    try {
      return this.jwtService.verify(token);
    } catch (_error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * Hash password using bcrypt
   *
   * @param password Plain text password
   * @returns Bcrypt hashed password
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.BCRYPT_ROUNDS);
  }

  /**
   * Generate JWT access token and refresh token
   *
   * @param userId User ID
   * @param username Username
   * @param role User role
   * @returns Access token and refresh token
   * @private
   */
  private async generateTokens(
    userId: string,
    username: string,
    role: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = { sub: userId, username, role };

    // Generate access token (1 hour expiry)
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
    });

    // Generate refresh token (7 day expiry)
    // Security: Use cryptographically secure random bytes instead of JWT
    const refreshToken = randomBytes(64).toString('base64url');

    return { accessToken, refreshToken };
  }
}
