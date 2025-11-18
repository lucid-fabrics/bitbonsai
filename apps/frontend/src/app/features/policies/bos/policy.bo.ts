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
  targetContainer?: string | null;
  skipReencoding?: boolean;
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
    const apiModel = model as PolicyModel & Record<string, unknown>;

    this.id = model.id;
    this.name = model.name;
    this.preset = model.preset;
    this.targetCodec = (apiModel.targetCodec as TargetCodec) || model.target_codec;
    this.targetQuality = (apiModel.targetQuality as number) || model.crf;
    this.targetContainer =
      (apiModel.targetContainer as string | null | undefined) ?? model.target_container ?? 'mkv';
    this.skipReencoding =
      (apiModel.skipReencoding as boolean | undefined) ?? model.skip_reencoding ?? true;
    this.libraryId = (apiModel.libraryId as string | undefined) || model.library_id;
    this.deviceProfiles = this.convertDeviceProfilesToArray(
      (apiModel.deviceProfiles as DeviceProfiles | undefined) || model.device_profiles
    );
    this.ffmpegFlags = (apiModel.ffmpegFlags as string | undefined) || model.ffmpeg_flags;
    this.audioHandling =
      (apiModel.audioHandling as AudioHandling | undefined) || model.audio_handling;
    this.hardwareAcceleration =
      (apiModel.hardwareAcceleration as HardwareAcceleration | undefined) ||
      model.hardware_acceleration;
    this.completedJobs = (apiModel.completedJobs as number) ?? model.completed_jobs ?? 0;
    this.createdAt = new Date((apiModel.createdAt as string) || model.created_at || Date.now());
    this.updatedAt = new Date((apiModel.updatedAt as string) || model.updated_at || Date.now());
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
