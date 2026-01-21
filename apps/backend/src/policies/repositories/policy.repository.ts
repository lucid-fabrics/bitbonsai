import { Injectable } from '@nestjs/common';
import { JobStage, type Policy, PolicyPreset, TargetCodec } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface PolicyWithStats extends Policy {
  library?: { id: string; name: string } | null;
  _count: { jobs: number };
}

export interface CreatePolicyData {
  name: string;
  preset: string;
  targetCodec: string;
  targetQuality: number;
  deviceProfiles: object;
  advancedSettings: object;
  atomicReplace: boolean;
  verifyOutput: boolean;
  skipSeeding: boolean;
  allowSameCodec: boolean;
  minSavingsPercent: number;
  libraryId?: string | null;
}

export interface UpdatePolicyData {
  name?: string;
  preset?: string;
  targetCodec?: string;
  targetQuality?: number;
  deviceProfiles?: object;
  advancedSettings?: object;
  atomicReplace?: boolean;
  verifyOutput?: boolean;
  skipSeeding?: boolean;
  allowSameCodec?: boolean;
  minSavingsPercent?: number;
  libraryId?: string | null;
}

@Injectable()
export class PolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new policy in the database
   */
  async create(data: CreatePolicyData): Promise<Policy> {
    return this.prisma.policy.create({
      data: {
        name: data.name,
        preset: data.preset as PolicyPreset,
        targetCodec: data.targetCodec as TargetCodec,
        targetQuality: data.targetQuality,
        deviceProfiles: data.deviceProfiles,
        advancedSettings: data.advancedSettings,
        atomicReplace: data.atomicReplace,
        verifyOutput: data.verifyOutput,
        skipSeeding: data.skipSeeding,
        allowSameCodec: data.allowSameCodec,
        minSavingsPercent: data.minSavingsPercent,
        libraryId: data.libraryId,
      },
    });
  }

  /**
   * Find all policies
   */
  async findAll(): Promise<Policy[]> {
    return this.prisma.policy.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find policy by ID
   */
  async findById(id: string): Promise<Policy | null> {
    return this.prisma.policy.findUnique({
      where: { id },
    });
  }

  /**
   * Find policy by ID with statistics
   */
  async findByIdWithStats(id: string): Promise<PolicyWithStats | null> {
    return this.prisma.policy.findUnique({
      where: { id },
      include: {
        library: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            jobs: {
              where: {
                stage: JobStage.COMPLETED,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Update a policy
   */
  async update(id: string, data: UpdatePolicyData): Promise<Policy> {
    return this.prisma.policy.update({
      where: { id },
      data: {
        name: data.name,
        preset: data.preset as PolicyPreset,
        targetCodec: data.targetCodec as TargetCodec,
        targetQuality: data.targetQuality,
        deviceProfiles: data.deviceProfiles,
        advancedSettings: data.advancedSettings,
        atomicReplace: data.atomicReplace,
        verifyOutput: data.verifyOutput,
        skipSeeding: data.skipSeeding,
        allowSameCodec: data.allowSameCodec,
        minSavingsPercent: data.minSavingsPercent,
        libraryId: data.libraryId,
      },
    });
  }

  /**
   * Delete a policy
   */
  async delete(id: string): Promise<void> {
    await this.prisma.policy.delete({
      where: { id },
    });
  }
}
