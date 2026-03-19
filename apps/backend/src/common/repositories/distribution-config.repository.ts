import { Injectable } from '@nestjs/common';
import { type DistributionConfig } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from './base.repository';

@Injectable()
export class DistributionConfigRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma, 'distributionConfig');
  }

  async findActive(): Promise<DistributionConfig | null> {
    return this.findFirst<DistributionConfig | null>({ where: { isActive: true } });
  }

  async findOrCreateDefault(): Promise<DistributionConfig> {
    const existing = await this.findActive();
    if (existing) return existing;
    return this.create<DistributionConfig>({ data: { id: 'default' } });
  }

  async updateById(id: string, data: Record<string, unknown>): Promise<DistributionConfig> {
    return this.update<DistributionConfig>({ where: { id }, data });
  }
}
