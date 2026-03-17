import { Injectable } from '@nestjs/common';
import { type Policy, type PolicyPreset, type Prisma, type TargetCodec } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface PolicyWithRelations extends Policy {
  library?: { id: string; name: string } | null;
  _count: { jobs: number };
}

/** JSON structure for device compatibility profiles */
export interface DeviceProfiles {
  appleTv?: boolean;
  roku?: boolean;
  web?: boolean;
  chromecast?: boolean;
  [key: string]: boolean | undefined;
}

/** JSON structure for advanced encoding settings */
export interface AdvancedSettings {
  ffmpegFlags?: string[];
  hwaccel?: string;
  [key: string]: unknown;
}

@Injectable()
export class PolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Policy | null> {
    return this.prisma.policy.findUnique({ where: { id } });
  }

  async findByIdWithRelations(id: string): Promise<PolicyWithRelations | null> {
    return this.prisma.policy.findUnique({
      where: { id },
      include: {
        library: { select: { id: true, name: true } },
        _count: { select: { jobs: true } },
      },
    }) as Promise<PolicyWithRelations | null>;
  }

  async findAll(): Promise<Policy[]> {
    return this.prisma.policy.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllWithRelations(): Promise<PolicyWithRelations[]> {
    return this.prisma.policy.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        library: { select: { id: true, name: true } },
        _count: { select: { jobs: true } },
      },
    }) as Promise<PolicyWithRelations[]>;
  }

  async findByLibraryId(libraryId: string): Promise<Policy[]> {
    return this.prisma.policy.findMany({
      where: { libraryId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findGlobal(): Promise<Policy[]> {
    return this.prisma.policy.findMany({
      where: { libraryId: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByPreset(preset: PolicyPreset): Promise<Policy[]> {
    return this.prisma.policy.findMany({
      where: { preset },
    });
  }

  async create(data: {
    name: string;
    preset: PolicyPreset;
    targetCodec: TargetCodec;
    targetQuality: number;
    deviceProfiles: DeviceProfiles;
    advancedSettings: AdvancedSettings;
    atomicReplace?: boolean;
    verifyOutput?: boolean;
    skipSeeding?: boolean;
    allowSameCodec?: boolean;
    minSavingsPercent?: number;
    libraryId?: string;
  }): Promise<Policy> {
    return this.prisma.policy.create({
      data: {
        name: data.name,
        preset: data.preset,
        targetCodec: data.targetCodec,
        targetQuality: data.targetQuality,
        deviceProfiles: data.deviceProfiles as unknown as Prisma.InputJsonValue,
        advancedSettings: data.advancedSettings as unknown as Prisma.InputJsonValue,
        atomicReplace: data.atomicReplace ?? true,
        verifyOutput: data.verifyOutput ?? true,
        skipSeeding: data.skipSeeding ?? false,
        allowSameCodec: data.allowSameCodec ?? false,
        minSavingsPercent: data.minSavingsPercent ?? 0,
        libraryId: data.libraryId,
      },
    });
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      preset: PolicyPreset;
      targetCodec: TargetCodec;
      targetQuality: number;
      deviceProfiles: DeviceProfiles;
      advancedSettings: AdvancedSettings;
      atomicReplace: boolean;
      verifyOutput: boolean;
      skipSeeding: boolean;
      allowSameCodec: boolean;
      minSavingsPercent: number;
      libraryId: string | null;
    }>
  ): Promise<Policy> {
    return this.prisma.policy.update({
      where: { id },
      data: data as Prisma.PolicyUpdateInput,
    });
  }

  async delete(id: string): Promise<Policy> {
    return this.prisma.policy.delete({ where: { id } });
  }

  async count(): Promise<number> {
    return this.prisma.policy.count();
  }

  async countByLibrary(libraryId: string): Promise<number> {
    return this.prisma.policy.count({ where: { libraryId } });
  }
}
