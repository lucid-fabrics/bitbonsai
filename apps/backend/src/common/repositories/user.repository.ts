import { Injectable } from '@nestjs/common';
import { type User, type UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async findAll(): Promise<User[]> {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByRole(role: UserRole): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { role },
    });
  }

  async create(data: {
    username: string;
    email: string;
    passwordHash: string;
    role?: UserRole;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        username: data.username,
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role ?? 'USER',
      },
    });
  }

  async update(
    id: string,
    data: {
      username?: string;
      email?: string;
      passwordHash?: string;
      role?: UserRole;
      isActive?: boolean;
    }
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<User> {
    return this.prisma.user.delete({ where: { id } });
  }

  async count(): Promise<number> {
    return this.prisma.user.count();
  }

  async countByRole(): Promise<Record<UserRole, number>> {
    const result = await this.prisma.user.groupBy({
      by: ['role'],
      _count: true,
    });

    const counts: Partial<Record<UserRole, number>> = {};
    for (const r of result) {
      counts[r.role as UserRole] = r._count;
    }
    return counts as Record<UserRole, number>;
  }
}
