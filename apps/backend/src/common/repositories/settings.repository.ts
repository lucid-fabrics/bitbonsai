import { Injectable } from '@nestjs/common';
import { type Prisma, type Settings } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findFirst(): Promise<Settings | null> {
    return this.prisma.settings.findFirst();
  }

  async findUnique(where: { id: string }): Promise<Settings | null> {
    return this.prisma.settings.findUnique({ where });
  }

  async create(data: {
    isSetupComplete?: boolean;
    advancedModeEnabled?: boolean;
    licenseKey?: string;
  }): Promise<Settings> {
    return this.prisma.settings.create({ data });
  }

  async update(where: { id: string }, data: Partial<Settings>): Promise<Settings> {
    return this.prisma.settings.update({ where, data });
  }

  async upsert(where: { id: string }, data: Partial<Settings>): Promise<Settings> {
    return this.prisma.settings.upsert({
      where,
      update: data,
      create: data as Prisma.SettingsCreateInput,
    });
  }

  async delete(where: { id: string }): Promise<Settings> {
    return this.prisma.settings.delete({ where });
  }

  async findOrCreate(): Promise<Settings> {
    const existing = await this.findFirst();
    if (existing) return existing;
    return this.create({});
  }

  /**
   * Atomically find-or-create, then optionally update.
   * Replaces the prisma.$transaction(findFirst + create/update) pattern.
   */
  async upsertSettings(data: Record<string, unknown>): Promise<Settings> {
    return this.prisma.$transaction(async (tx) => {
      let s = await tx.settings.findFirst();

      if (!s) {
        s = await tx.settings.create({ data });
      } else {
        s = await tx.settings.update({ where: { id: s.id }, data });
      }

      return s;
    });
  }

  /**
   * Atomically find-or-create with default data, without updating if already exists.
   */
  async findOrCreateWithDefaults(defaults: Record<string, unknown>): Promise<Settings> {
    return this.prisma.$transaction(async (tx) => {
      let s = await tx.settings.findFirst();

      if (!s) {
        s = await tx.settings.create({ data: defaults });
      }

      return s;
    });
  }
}
