import { Injectable } from '@nestjs/common';
import { type License, LicenseStatus, type LicenseTier, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from './base.repository';

/** JSON structure for license feature flags */
export interface LicenseFeatures {
  multiNode?: boolean;
  advancedPresets?: boolean;
  api?: boolean;
  [key: string]: boolean | undefined;
}

@Injectable()
export class LicenseRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma, 'license');
  }

  async findById(id: string): Promise<License | null> {
    return super.findUnique<License | null>({ where: { id } });
  }

  async findByIdWithSelect<T>(id: string, select: Record<string, unknown>): Promise<T | null> {
    return super.findUnique<T | null>({ where: { id }, select });
  }

  async findByKey(key: string): Promise<License | null> {
    return super.findUnique<License | null>({ where: { key } });
  }

  async findByKeyWithInclude<T>(key: string, include: Record<string, unknown>): Promise<T | null> {
    return super.findUnique<T | null>({ where: { key }, include });
  }

  async findByEmail(email: string): Promise<License[]> {
    return super.findMany<License>({ where: { email } });
  }

  async findActive(): Promise<License[]> {
    return super.findMany<License>({ where: { status: LicenseStatus.ACTIVE } });
  }

  async findFirstActive(): Promise<License | null> {
    return super.findFirst<License | null>({ where: { status: LicenseStatus.ACTIVE } });
  }

  async findFirstActiveWithSelect<T>(select: Record<string, unknown>): Promise<T | null> {
    return super.findFirst<T | null>({ where: { status: LicenseStatus.ACTIVE }, select });
  }

  async findFirstActiveDesc(): Promise<License | null> {
    return super.findFirst<License | null>({
      where: { status: LicenseStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByTier(tier: LicenseTier): Promise<License[]> {
    return super.findMany<License>({ where: { tier } });
  }

  async createLicense(data: {
    key: string;
    tier: LicenseTier;
    status: LicenseStatus;
    email: string;
    maxNodes: number;
    maxConcurrentJobs: number;
    features: LicenseFeatures | Prisma.InputJsonValue;
    validUntil?: Date | null;
  }): Promise<License> {
    return super.create<License>({ data });
  }

  async updateById(
    id: string,
    data: {
      status?: LicenseStatus;
      validUntil?: Date | null;
      maxNodes?: number;
      maxConcurrentJobs?: number;
      features?: LicenseFeatures | Prisma.InputJsonValue;
      updatedAt?: Date;
      key?: string;
      tier?: LicenseTier;
      email?: string;
    }
  ): Promise<License> {
    return super.update<License>({ where: { id }, data });
  }

  async updateByKey(key: string, data: Record<string, unknown>): Promise<License> {
    return super.update<License>({ where: { key }, data });
  }

  async deleteById(id: string): Promise<License> {
    return super.delete<License>({ where: { id } });
  }

  async upsertByEmail(
    email: string,
    updateData: Record<string, unknown>,
    createData: Prisma.LicenseCreateInput
  ): Promise<License> {
    return this.prisma.license.upsert({
      where: { email },
      update: updateData,
      create: createData,
    });
  }

  async transactionFindFirstAndUpsert(licenseData: Record<string, unknown>): Promise<License> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.license.findFirst();
      if (existing) {
        return tx.license.update({
          where: { id: existing.id },
          data: licenseData,
        });
      }
      return tx.license.create({ data: licenseData as Prisma.LicenseCreateInput });
    });
  }

  async findFirstWhere(where: Prisma.LicenseWhereInput): Promise<License | null> {
    return super.findFirst<License | null>({ where });
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
