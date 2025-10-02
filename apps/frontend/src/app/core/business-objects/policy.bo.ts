import { AudioHandling, DeviceProfile, PolicyModel, PolicyPreset, TargetCodec } from '../models/policy.model';

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
  completedJobs: number;
  createdAt: Date;
  updatedAt: Date;

  constructor(model: PolicyModel) {
    this.id = model.id;
    this.name = model.name;
    this.preset = model.preset;
    this.targetCodec = model.target_codec;
    this.targetQuality = model.crf;
    this.libraryId = model.library_id;
    this.deviceProfiles = model.device_profiles || [];
    this.ffmpegFlags = model.ffmpeg_flags;
    this.audioHandling = model.audio_handling;
    this.completedJobs = model.completed_jobs;
    this.createdAt = new Date(model.created_at);
    this.updatedAt = new Date(model.updated_at);
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
