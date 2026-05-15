import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Prisma delegate interface representing the common query methods
 * available on all Prisma model delegates (e.g., prisma.user, prisma.job).
 */
interface PrismaDelegate {
  findUnique(args: unknown): Promise<unknown>;
  findFirst(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  delete(args: unknown): Promise<unknown>;
  deleteMany(args: unknown): Promise<Prisma.BatchPayload>;
  count(args?: unknown): Promise<number>;
  aggregate(args: unknown): Promise<unknown>;
}

@Injectable()
export class BaseRepository {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly modelName: string
  ) {}

  protected get model(): PrismaDelegate {
    return (this.prisma as unknown as Record<string, PrismaDelegate>)[this.modelName];
  }

  async findUnique<T = unknown>(args: Record<string, unknown>): Promise<T> {
    return this.model.findUnique(args) as Promise<T>;
  }

  async findFirst<T = unknown>(args: Record<string, unknown>): Promise<T> {
    return this.model.findFirst(args) as Promise<T>;
  }

  async findMany<T = unknown>(args: Record<string, unknown>): Promise<T[]> {
    return this.model.findMany(args) as Promise<T[]>;
  }

  async create<T = unknown>(args: Record<string, unknown>): Promise<T> {
    return this.model.create(args) as Promise<T>;
  }

  async update<T = unknown>(args: Record<string, unknown>): Promise<T> {
    return this.model.update(args) as Promise<T>;
  }

  async delete<T = unknown>(args: Record<string, unknown>): Promise<T> {
    return this.model.delete(args) as Promise<T>;
  }

  async deleteMany(args: Record<string, unknown>): Promise<Prisma.BatchPayload> {
    return this.model.deleteMany(args);
  }

  async count(args: Record<string, unknown>): Promise<number> {
    return this.model.count(args);
  }

  async aggregate<T = unknown>(args: Record<string, unknown>): Promise<T> {
    return this.model.aggregate(args) as Promise<T>;
  }
}
