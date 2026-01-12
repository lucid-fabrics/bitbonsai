import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { LoginDto } from './dto/login.dto';
import { AdminUserEntity } from './entities/admin-user.entity';
import { JwtPayload } from './jwt.strategy';

export interface LoginResponse {
  accessToken: string;
  user: AdminUserEntity;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
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

    await this.auditService.log({
      action: 'admin_login',
      entityType: 'AdminUser',
      entityId: user.id,
      userId: user.id,
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);
    const { passwordHash, ...userWithoutPassword } = user;

    return { accessToken, user: userWithoutPassword as AdminUserEntity };
  }

  async createAdmin(
    dto: CreateAdminDto,
    createdBy: string,
  ): Promise<AdminUserEntity> {
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const admin = await this.prisma.adminUser.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: dto.role,
        createdBy,
      },
    });

    await this.auditService.log({
      action: 'admin_created',
      entityType: 'AdminUser',
      entityId: admin.id,
      userId: createdBy,
      metadata: {
        email: dto.email,
        name: dto.name,
        role: dto.role,
      },
    });

    const { passwordHash: _, ...adminWithoutPassword } = admin;
    return adminWithoutPassword as AdminUserEntity;
  }

  async getAllAdmins(): Promise<AdminUserEntity[]> {
    const admins = await this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return admins.map(({ passwordHash, ...admin }) => admin as AdminUserEntity);
  }

  async toggleAdminStatus(
    userId: string,
    currentUserId: string,
  ): Promise<AdminUserEntity> {
    if (userId === currentUserId) {
      throw new UnauthorizedException('Cannot modify your own account status');
    }

    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const updated = await this.prisma.adminUser.update({
      where: { id: userId },
      data: { isActive: !user.isActive },
    });

    await this.auditService.log({
      action: updated.isActive ? 'admin_activated' : 'admin_deactivated',
      entityType: 'AdminUser',
      entityId: userId,
      userId: currentUserId,
      metadata: {
        oldStatus: user.isActive,
        newStatus: updated.isActive,
      },
    });

    const { passwordHash, ...adminWithoutPassword } = updated;
    return adminWithoutPassword as AdminUserEntity;
  }
}
