import {
  type AudioHandling,
  type DeviceProfile,
  type DeviceProfiles,
  type HardwareAcceleration,
  type PolicyModel,
  PolicyPreset,
  type TargetCodec,
} from '../models/policy.model';

export class PolicyBo {
  id: string;
  name: string;
  preset: PolicyPreset;
  targetCodec: TargetCodec;
  targetQuality: number;
  libraryId?: string;
  deviceProfiles: DeviceProfile[];
  ffmpegFlags?: string;
  audioHandling?: AudioHandling;
  hardwareAcceleration?: HardwareAcceleration;
  completedJobs: number;
  createdAt: Date;
  updatedAt: Date;

  constructor(model: PolicyModel) {
    // API returns camelCase but PolicyModel expects snake_case, handle both
    const apiModel = model as any;

    this.id = model.id;
    this.name = model.name;
    this.preset = model.preset;
    this.targetCodec = apiModel.targetCodec || model.target_codec;
    this.targetQuality = apiModel.targetQuality || model.crf;
    this.libraryId = apiModel.libraryId || model.library_id;
    this.deviceProfiles = this.convertDeviceProfilesToArray(
      apiModel.deviceProfiles || model.device_profiles
    );
    this.ffmpegFlags = apiModel.ffmpegFlags || model.ffmpeg_flags;
    this.audioHandling = apiModel.audioHandling || model.audio_handling;
    this.hardwareAcceleration = apiModel.hardwareAcceleration || model.hardware_acceleration;
    this.completedJobs = apiModel.completedJobs || model.completed_jobs;
    this.createdAt = new Date(apiModel.createdAt || model.created_at);
    this.updatedAt = new Date(apiModel.updatedAt || model.updated_at);
  }

  private convertDeviceProfilesToArray(profiles: DeviceProfiles | undefined): DeviceProfile[] {
    if (!profiles) return [];

    const result: DeviceProfile[] = [];
    if (profiles.appleTV) result.push('APPLE_TV' as DeviceProfile);
    if (profiles.roku) result.push('ROKU' as DeviceProfile);
    if (profiles.web) result.push('WEB' as DeviceProfile);
    if (profiles.chromecast) result.push('CHROMECAST' as DeviceProfile);

    return result;
  }

  get isCustomPreset(): boolean {
    return this.preset === PolicyPreset.CUSTOM;
  }

  get hasLibraryRestriction(): boolean {
    return !!this.libraryId;
  }

  get formattedCreatedAt(): string {
    return this.createdAt.toLocaleDateString();
  }
}
