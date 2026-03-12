import { Injectable } from '@nestjs/common';
import { type Settings } from '@prisma/client';
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
      create: data as any,
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
}
