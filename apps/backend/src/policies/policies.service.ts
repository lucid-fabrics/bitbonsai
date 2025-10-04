import {
  type AdvancedSettings,
  type DeviceProfiles,
  PolicyPreset,
  TargetCodec,
} from '@bitbonsai/shared-models';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreatePolicyDto } from './dto/create-policy.dto';
import type { PolicyDto } from './dto/policy.dto';
import type { PolicyStatsDto } from './dto/policy-stats.dto';
import type { PresetInfoDto } from './dto/preset-info.dto';
import type { UpdatePolicyDto } from './dto/update-policy.dto';
import type { PolicyRepository } from './repositories/policy.repository';

@Injectable()
export class PoliciesService {
  constructor(private readonly policyRepository: PolicyRepository) {}

  /**
   * Create a new encoding policy
   */
  async create(createPolicyDto: CreatePolicyDto): Promise<PolicyDto> {
    const deviceProfiles: DeviceProfiles = createPolicyDto.deviceProfiles || {
      appleTv: true,
      roku: true,
      web: true,
      chromecast: true,
      ps5: true,
      xbox: true,
    };

    const advancedSettings: AdvancedSettings = createPolicyDto.advancedSettings || {
      ffmpegFlags: ['-preset', 'medium'],
      hwaccel: 'auto',
      audioCodec: 'copy',
      subtitleHandling: 'copy',
    };

    const policy = await this.policyRepository.create({
      name: createPolicyDto.name,
      preset: createPolicyDto.preset,
      targetCodec: createPolicyDto.targetCodec,
      targetQuality: createPolicyDto.targetQuality,
      deviceProfiles: deviceProfiles as object,
      advancedSettings: advancedSettings as object,
      atomicReplace: createPolicyDto.atomicReplace ?? true,
      verifyOutput: createPolicyDto.verifyOutput ?? true,
      skipSeeding: createPolicyDto.skipSeeding ?? true,
      libraryId: createPolicyDto.libraryId,
    });

    return this.mapPolicyToDto(policy);
  }

  /**
   * Get all policies
   */
  async findAll(): Promise<PolicyDto[]> {
    const policies = await this.policyRepository.findAll();
    return policies.map((policy) => this.mapPolicyToDto(policy));
  }

  /**
   * Get policy with job statistics
   */
  async findOne(id: string): Promise<PolicyStatsDto> {
    const policy = await this.policyRepository.findByIdWithStats(id);

    if (!policy) {
      throw new NotFoundException(`Policy with ID "${id}" not found`);
    }

    return this.mapPolicyToStatsDto(policy);
  }

  /**
   * Update a policy
   */
  async update(id: string, updatePolicyDto: UpdatePolicyDto): Promise<PolicyDto> {
    // Check if policy exists
    await this.findOne(id);

    const policy = await this.policyRepository.update(id, {
      name: updatePolicyDto.name,
      preset: updatePolicyDto.preset,
      targetCodec: updatePolicyDto.targetCodec,
      targetQuality: updatePolicyDto.targetQuality,
      deviceProfiles: updatePolicyDto.deviceProfiles as object | undefined,
      advancedSettings: updatePolicyDto.advancedSettings as object | undefined,
      atomicReplace: updatePolicyDto.atomicReplace,
      verifyOutput: updatePolicyDto.verifyOutput,
      skipSeeding: updatePolicyDto.skipSeeding,
      libraryId: updatePolicyDto.libraryId,
    });

    return this.mapPolicyToDto(policy);
  }

  /**
   * Delete a policy
   */
  async remove(id: string): Promise<void> {
    // Check if policy exists
    await this.findOne(id);

    await this.policyRepository.delete(id);
  }

  /**
   * Get available presets with descriptions
   */
  getPresets(): PresetInfoDto[] {
    return [
      {
        preset: PolicyPreset.BALANCED_HEVC,
        name: 'Balanced HEVC',
        description:
          'Balanced quality and speed for general-purpose HEVC encoding. Ideal for most media libraries.',
        defaultCodec: TargetCodec.HEVC,
        recommendedQuality: 23,
      },
      {
        preset: PolicyPreset.FAST_HEVC,
        name: 'Fast HEVC',
        description:
          'Prioritizes encoding speed over quality. Good for large libraries where time is critical.',
        defaultCodec: TargetCodec.HEVC,
        recommendedQuality: 26,
      },
      {
        preset: PolicyPreset.QUALITY_AV1,
        name: 'Quality AV1',
        description:
          'Maximum quality and efficiency using AV1 codec. Slower encoding but best compression.',
        defaultCodec: TargetCodec.AV1,
        recommendedQuality: 28,
      },
      {
        preset: PolicyPreset.COPY_IF_COMPLIANT,
        name: 'Copy if Compliant',
        description:
          'Copy streams without re-encoding if already in target codec. Fastest option for compatible files.',
        defaultCodec: TargetCodec.HEVC,
        recommendedQuality: 0,
      },
      {
        preset: PolicyPreset.CUSTOM,
        name: 'Custom',
        description: 'Fully customizable encoding policy with manual control over all parameters.',
        defaultCodec: TargetCodec.HEVC,
        recommendedQuality: 23,
      },
    ];
  }

  /**
   * Map Prisma policy to PolicyDto
   */
  private mapPolicyToDto(policy: {
    id: string;
    name: string;
    preset: string;
    targetCodec: string;
    targetQuality: number;
    deviceProfiles: any;
    advancedSettings: any;
    atomicReplace: boolean;
    verifyOutput: boolean;
    skipSeeding: boolean;
    libraryId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): PolicyDto {
    return {
      id: policy.id,
      name: policy.name,
      preset: policy.preset as PolicyPreset,
      targetCodec: policy.targetCodec as TargetCodec,
      targetQuality: policy.targetQuality,
      deviceProfiles: policy.deviceProfiles,
      advancedSettings: policy.advancedSettings,
      atomicReplace: policy.atomicReplace,
      verifyOutput: policy.verifyOutput,
      skipSeeding: policy.skipSeeding,
      libraryId: policy.libraryId,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    };
  }

  /**
   * Map Prisma policy with stats to PolicyStatsDto
   */
  private mapPolicyToStatsDto(policy: {
    id: string;
    name: string;
    preset: string;
    targetCodec: string;
    targetQuality: number;
    deviceProfiles: any;
    advancedSettings: any;
    atomicReplace: boolean;
    verifyOutput: boolean;
    skipSeeding: boolean;
    library?: { id: string; name: string } | null;
    _count: { jobs: number };
    createdAt: Date;
    updatedAt: Date;
  }): PolicyStatsDto {
    return {
      id: policy.id,
      name: policy.name,
      preset: policy.preset as PolicyPreset,
      targetCodec: policy.targetCodec as TargetCodec,
      targetQuality: policy.targetQuality,
      deviceProfiles: policy.deviceProfiles,
      advancedSettings: policy.advancedSettings,
      atomicReplace: policy.atomicReplace,
      verifyOutput: policy.verifyOutput,
      skipSeeding: policy.skipSeeding,
      library: policy.library || null,
      _count: { jobs: policy._count.jobs },
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    };
  }
}
