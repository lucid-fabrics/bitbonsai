import { Injectable } from '@nestjs/common';
import { type License, type LicenseStatus, type LicenseTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** JSON structure for license feature flags */
export interface LicenseFeatures {
  multiNode?: boolean;
  advancedPresets?: boolean;
  api?: boolean;
  [key: string]: boolean | undefined;
}

@Injectable()
export class LicenseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<License | null> {
    return this.prisma.license.findUnique({ where: { id } });
  }

  async findByKey(key: string): Promise<License | null> {
    return this.prisma.license.findUnique({ where: { key } });
  }

  async findByEmail(email: string): Promise<License[]> {
    return this.prisma.license.findMany({ where: { email } });
  }

  async findActive(): Promise<License[]> {
    return this.prisma.license.findMany({
      where: { status: 'ACTIVE' as LicenseStatus },
    });
  }

  async findByTier(tier: LicenseTier): Promise<License[]> {
    return this.prisma.license.findMany({ where: { tier } });
  }

  async create(data: {
    key: string;
    tier: LicenseTier;
    status: LicenseStatus;
    email: string;
    maxNodes: number;
    maxConcurrentJobs: number;
    features: LicenseFeatures;
    validUntil?: Date;
  }): Promise<License> {
    return this.prisma.license.create({ data });
  }

  async update(
    id: string,
    data: {
      status?: LicenseStatus;
      validUntil?: Date;
      maxNodes?: number;
      maxConcurrentJobs?: number;
      features?: LicenseFeatures;
    }
  ): Promise<License> {
    return this.prisma.license.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<License> {
    return this.prisma.license.delete({ where: { id } });
  }

  async countByStatus(): Promise<Record<LicenseStatus, number>> {
    const result = await this.prisma.license.groupBy({
      by: ['status'],
      _count: true,
    });

    const counts: Partial<Record<LicenseStatus, number>> = {};
    for (const r of result) {
      counts[r.status as LicenseStatus] = r._count;
    }
    return counts as Record<LicenseStatus, number>;
  }
}
