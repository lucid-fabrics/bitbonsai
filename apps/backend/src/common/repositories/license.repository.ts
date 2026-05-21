import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** JSON structure for license feature flags */
export interface LicenseFeatures {
  multiNode?: boolean;
  advancedPresets?: boolean;
  api?: boolean;
  [key: string]: boolean | undefined;
}

type StubLicense = {
  id: string;
  key: string;
  tier: string;
  status: string;
  email: string;
  maxNodes: number;
  maxConcurrentJobs: number;
  features: Record<string, unknown>;
  validUntil: null;
  createdAt: Date;
  updatedAt: Date;
};

function makeStub(data: Record<string, unknown> = {}): StubLicense {
  return {
    id: 'stub-license-id',
    key: (data.key as string) || 'stub-key',
    tier: (data.tier as string) || 'FREE',
    status: (data.status as string) || 'ACTIVE',
    email: (data.email as string) || 'stub@localhost',
    maxNodes: (data.maxNodes as number) || 1,
    maxConcurrentJobs: (data.maxConcurrentJobs as number) || 2,
    features: (data.features as Record<string, unknown>) || {},
    validUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * LicenseRepository - STUBBED
 *
 * The License model has been removed from the schema.
 * All methods return null/empty to preserve call-site compatibility
 * while the codebase migrates to cloud-auth entitlements.
 */
@Injectable()
export class LicenseRepository {
  // Expose prisma for compatibility with any code that accesses it directly
  readonly prisma: PrismaService;

  constructor(prisma: PrismaService) {
    this.prisma = prisma;
  }

  async findById(_id: string): Promise<null> {
    return null;
  }

  async findByIdWithSelect<T>(_id: string, _select: Record<string, unknown>): Promise<T | null> {
    return null;
  }

  async findByKey(_key: string): Promise<null> {
    return null;
  }

  async findByKeyWithInclude<T>(
    _key: string,
    _include: Record<string, unknown>
  ): Promise<T | null> {
    return null;
  }

  async findByEmail(_email: string): Promise<StubLicense[]> {
    return [];
  }

  async findActive(): Promise<StubLicense[]> {
    return [];
  }

  async findFirstActive(): Promise<StubLicense | null> {
    return null;
  }

  async findFirstActiveWithSelect<T>(_select: Record<string, unknown>): Promise<T | null> {
    return null;
  }

  async findFirstActiveDesc(): Promise<StubLicense | null> {
    return null;
  }

  async findByTier(_tier: string): Promise<StubLicense[]> {
    return [];
  }

  async createLicense(data: Record<string, unknown>): Promise<StubLicense> {
    return makeStub(data);
  }

  async updateById(_id: string, _data: Record<string, unknown>): Promise<StubLicense | null> {
    return null;
  }

  async updateByKey(_key: string, _data: Record<string, unknown>): Promise<StubLicense | null> {
    return null;
  }

  async deleteById(_id: string): Promise<StubLicense | null> {
    return null;
  }

  async upsertByEmail(
    email: string,
    _updateData: Record<string, unknown>,
    createData: Record<string, unknown>
  ): Promise<StubLicense> {
    return makeStub({ ...createData, email });
  }

  async transactionFindFirstAndUpsert(licenseData: Record<string, unknown>): Promise<StubLicense> {
    return makeStub(licenseData);
  }

  async findFirstWhere(_where: Record<string, unknown>): Promise<StubLicense | null> {
    return null;
  }

  async findFirst<T = StubLicense>(_args?: Record<string, unknown>): Promise<T | null> {
    return null;
  }

  async findUnique<T = StubLicense>(_args: Record<string, unknown>): Promise<T | null> {
    return null;
  }

  async findMany<T = StubLicense>(_args?: Record<string, unknown>): Promise<T[]> {
    return [];
  }

  async count(_args?: Record<string, unknown>): Promise<number> {
    return 0;
  }

  async countByStatus(): Promise<Record<string, number>> {
    return {};
  }
}
