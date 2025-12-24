import { License, LicenseStatus, LicenseTier, PaymentProvider } from '.prisma/license-client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface CreateLicenseData {
  key: string;
  email: string;
  tier: LicenseTier;
  maxNodes: number;
  maxConcurrentJobs: number;
  expiresAt?: Date | null;
  provider?: PaymentProvider;
  providerCustomerId?: string;
  providerEmail?: string;
}

@Injectable()
export class LicenseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateLicenseData): Promise<License> {
    return this.prisma.license.create({ data });
  }

  async findById(id: string): Promise<License | null> {
    return this.prisma.license.findUnique({ where: { id } });
  }

  async findByKey(key: string): Promise<License | null> {
    return this.prisma.license.findUnique({ where: { key } });
  }

  async findByEmail(email: string): Promise<License[]> {
    return this.prisma.license.findMany({ where: { email } });
  }

  async findByProviderCustomerId(
    provider: PaymentProvider,
    customerId: string
  ): Promise<License | null> {
    return this.prisma.license.findFirst({ where: { provider, providerCustomerId: customerId } });
  }

  async findAll(options?: { skip?: number; take?: number }): Promise<License[]> {
    return this.prisma.license.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: { createdAt: 'desc' },
    });
  }

  async count(): Promise<number> {
    return this.prisma.license.count();
  }

  async update(id: string, data: Partial<CreateLicenseData>): Promise<License> {
    return this.prisma.license.update({ where: { id }, data });
  }

  async revoke(id: string, reason: string): Promise<License> {
    return this.prisma.license.update({
      where: { id },
      data: { status: LicenseStatus.REVOKED, revokedAt: new Date(), revokedReason: reason },
    });
  }
}
