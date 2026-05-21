export interface PolicyModel {
  id: string;
  name: string;
  preset: PolicyPreset;
  target_codec: TargetCodec;
  crf: number;
  target_container?: string | null;
  skip_reencoding?: boolean;
  allow_same_codec?: boolean;
  min_savings_percent?: number | null;
  library_id?: string;
  device_profiles: DeviceProfiles;
  ffmpeg_flags?: string;
  audio_handling?: AudioHandling;
  hardware_acceleration?: HardwareAcceleration;
  completed_jobs: number;
  created_at: string;
  updated_at: string;
}

export enum PolicyPreset {
  BALANCED_HEVC = 'BALANCED_HEVC',
  FAST_HEVC = 'FAST_HEVC',
  QUALITY_AV1 = 'QUALITY_AV1',
  COPY_IF_COMPLIANT = 'COPY_IF_COMPLIANT',
  CUSTOM = 'CUSTOM',
}

export enum TargetCodec {
  HEVC = 'HEVC',
  AV1 = 'AV1',
  VP9 = 'VP9',
  H264 = 'H264',
}

export enum DeviceProfile {
  APPLE_TV = 'APPLE_TV',
  ROKU = 'ROKU',
  WEB = 'WEB',
  CHROMECAST = 'CHROMECAST',
}

export enum AudioHandling {
  COPY = 'COPY',
  TRANSCODE_AAC = 'TRANSCODE_AAC',
  TRANSCODE_AC3 = 'TRANSCODE_AC3',
}

export interface PresetInfoModel {
  preset: PolicyPreset;
  name: string;
  description: string;
  codec: TargetCodec;
  crf: number;
  use_case: string;
  icon: string;
  recommended?: boolean;
}

export interface DeviceProfiles {
  appleTV: boolean;
  chromecast: boolean;
  roku: boolean;
  web: boolean;
}

export enum HardwareAcceleration {
  CPU = 'CPU',
  NVIDIA = 'NVIDIA',
  INTEL_QSV = 'INTEL_QSV',
  AMD = 'AMD',
  APPLE_M = 'APPLE_M',
}

export interface AdvancedSettings {
  ffmpegFlags?: string;
  audioHandling: AudioHandling;
  hardwareAcceleration?: HardwareAcceleration;
}

export interface CreatePolicyRequest {
  name: string;
  preset: PolicyPreset;
  targetCodec: TargetCodec;
  targetQuality: number;
  targetContainer?: string | null;
  skipReencoding?: boolean;
  allowSameCodec?: boolean;
  minSavingsPercent?: number;
  libraryId?: string;
  deviceProfiles: DeviceProfiles;
  advancedSettings: AdvancedSettings;
}

export interface UpdatePolicyRequest {
  name?: string;
  targetCodec?: TargetCodec;
  targetQuality?: number;
  targetContainer?: string | null;
  skipReencoding?: boolean;
  allowSameCodec?: boolean;
  minSavingsPercent?: number;
  libraryId?: string;
  deviceProfiles?: DeviceProfiles;
  advancedSettings?: AdvancedSettings;
}
