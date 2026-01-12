import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdminRole } from '@prisma/license-client';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { LoginDto } from './dto/login.dto';
import { AdminUserEntity } from './entities/admin-user.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: AdminRole;
}

export interface LoginResponse {
  accessToken: string;
  user: AdminUserEntity;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  async login(loginDto: LoginDto): Promise<LoginResponse> {
    const user = await this.prisma.adminUser.findUnique({
      where: { email: loginDto.email },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    // Audit log
    await this.auditService.log({
      action: 'admin_login',
      entityType: 'AdminUser',
      entityId: user.id,
      userId: user.id,
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...userWithoutPassword } = user;

    return {
      accessToken,
      user: userWithoutPassword,
    };
  }

  async createAdmin(
    createAdminDto: CreateAdminDto,
    createdBy?: string,
  ): Promise<AdminUserEntity> {
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(
      createAdminDto.password,
      saltRounds,
    );

    const user = await this.prisma.adminUser.create({
      data: {
        email: createAdminDto.email,
        passwordHash,
        name: createAdminDto.name,
        role: createAdminDto.role || AdminRole.ADMIN,
        createdBy,
      },
    });

    // Audit log
    if (createdBy) {
      await this.auditService.log({
        action: 'admin_created',
        entityType: 'AdminUser',
        entityId: user.id,
        userId: createdBy,
        changes: {
          email: createAdminDto.email,
          name: createAdminDto.name,
          role: user.role,
        },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async validateUser(userId: string): Promise<AdminUserEntity | null> {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
    });

    if (!user || !user.isActive) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async getAllAdmins(): Promise<AdminUserEntity[]> {
    const users = await this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return users.map(({ passwordHash, ...user }) => user);
  }

  async toggleAdminStatus(
    userId: string,
    currentUserId: string,
  ): Promise<AdminUserEntity> {
    if (userId === currentUserId) {
      throw new UnauthorizedException(
        'Cannot modify your own account status',
      );
    }

    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const newStatus = !user.isActive;

    const updated = await this.prisma.adminUser.update({
      where: { id: userId },
      data: { isActive: newStatus },
    });

    // Audit log
    await this.auditService.log({
      action: newStatus ? 'admin_activated' : 'admin_deactivated',
      entityType: 'AdminUser',
      entityId: userId,
      userId: currentUserId,
      changes: {
        isActive: { from: user.isActive, to: newStatus },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...userWithoutPassword } = updated;
    return userWithoutPassword;
  }
}
