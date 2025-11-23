import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { NodesModule } from '../nodes/nodes.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        // SECURITY: JWT_SECRET is REQUIRED in all environments
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error(
            'JWT_SECRET environment variable is required. ' +
              'Generate a strong secret with: openssl rand -base64 32'
          );
        }
        return {
          secret, // No fallback - fail fast if not configured
          signOptions: {
            expiresIn: '1h', // SECURITY: Short-lived access tokens
            algorithm: 'HS256',
          },
        };
      },
      inject: [ConfigService],
    }),
    NodesModule, // Required for ApiKeyGuard
    PrismaModule, // Required for database access
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
