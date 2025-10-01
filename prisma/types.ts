/**
 * BitBonsai Prisma Type Definitions
 *
 * Type-safe interfaces for JSON fields in the Prisma schema.
 * Import these types when working with JSON fields to get full TypeScript support.
 *
 * Usage:
 * ```typescript
 * import { LicenseFeatures, DeviceProfiles } from './prisma/types';
 *
 * const features = license.features as LicenseFeatures;
 * if (features.multiNode) {
 *   // Type-safe access
 * }
 * ```
 */

/**
 * License.features JSON field structure
 * Defines which premium features are available for a license
 */
export interface LicenseFeatures {
  /** Allow linking multiple nodes for distributed encoding */
  multiNode: boolean;

  /** Access to advanced encoding presets (AV1, custom FFmpeg settings) */
  advancedPresets: boolean;

  /** REST API access for automation and integrations */
  api: boolean;

  /** Priority job queue scheduling */
  priorityQueue: boolean;

  /** Cloud storage integration (S3, Backblaze B2, etc.) */
  cloudStorage: boolean;

  /** Custom webhook notifications for job events */
  webhooks: boolean;

  /** Advanced quality analysis and optimization recommendations */
  qualityAnalysis?: boolean;

  /** Hardware acceleration support beyond basic CPU encoding */
  hardwareAcceleration?: boolean;

  /** Custom branding (white-label) */
  customBranding?: boolean;
}

/**
 * Policy.deviceProfiles JSON field structure
 * Defines target device compatibility for encoding
 */
export interface DeviceProfiles {
  /** Apple TV 4K and later */
  appleTv: boolean;

  /** Roku devices (all models) */
  roku: boolean;

  /** Web browsers (Chrome, Firefox, Safari, Edge) */
  web: boolean;

  /** Google Chromecast */
  chromecast: boolean;

  /** Sony PlayStation 5 */
  ps5: boolean;

  /** Microsoft Xbox Series X/S */
  xbox: boolean;

  /** Amazon Fire TV */
  fireTv?: boolean;

  /** Android TV */
  androidTv?: boolean;

  /** Smart TVs (Samsung, LG, Sony) */
  smartTv?: boolean;
}

/**
 * Policy.advancedSettings JSON field structure
 * Custom FFmpeg parameters and encoding options
 */
export interface AdvancedSettings {
  /** Custom FFmpeg command-line flags */
  ffmpegFlags: string[];

  /** Hardware acceleration method (auto, cuda, qsv, vaapi, videotoolbox, etc.) */
  hwaccel: string;

  /** Audio codec handling (copy, aac, opus, etc.) */
  audioCodec: string;

  /** Subtitle handling strategy */
  subtitleHandling: 'copy' | 'burn' | 'remove' | 'extract';

  /** Custom FFmpeg video filter chain */
  customFilter?: string;

  /** Maximum bitrate (bits per second) */
  maxBitrate?: number;

  /** Target resolution (e.g., "1920x1080", "3840x2160") */
  targetResolution?: string;

  /** HDR to SDR tone mapping */
  hdrToSdr?: boolean;

  /** Deinterlacing mode */
  deinterlace?: 'auto' | 'always' | 'never';

  /** Crop detection and removal */
  autoCrop?: boolean;
}

/**
 * Metric.codecDistribution JSON field structure
 * Tracks distribution of codecs in encoded files
 */
export interface CodecDistribution {
  /** Percentage or count of files by codec name */
  [codecName: string]: number;
}

/**
 * Common codec names used in CodecDistribution
 */
export enum KnownCodecs {
  H264 = 'H.264',
  HEVC = 'HEVC',
  AV1 = 'AV1',
  VP9 = 'VP9',
  VP8 = 'VP8',
  MPEG2 = 'MPEG-2',
  MPEG4 = 'MPEG-4',
}

/**
 * Type guard to check if an object is LicenseFeatures
 */
export function isLicenseFeatures(obj: unknown): obj is LicenseFeatures {
  if (typeof obj !== 'object' || obj === null) return false;
  const features = obj as Partial<LicenseFeatures>;
  return (
    typeof features.multiNode === 'boolean' &&
    typeof features.advancedPresets === 'boolean' &&
    typeof features.api === 'boolean'
  );
}

/**
 * Type guard to check if an object is DeviceProfiles
 */
export function isDeviceProfiles(obj: unknown): obj is DeviceProfiles {
  if (typeof obj !== 'object' || obj === null) return false;
  const profiles = obj as Partial<DeviceProfiles>;
  return (
    typeof profiles.appleTv === 'boolean' &&
    typeof profiles.roku === 'boolean' &&
    typeof profiles.web === 'boolean'
  );
}

/**
 * Type guard to check if an object is AdvancedSettings
 */
export function isAdvancedSettings(obj: unknown): obj is AdvancedSettings {
  if (typeof obj !== 'object' || obj === null) return false;
  const settings = obj as Partial<AdvancedSettings>;
  return (
    Array.isArray(settings.ffmpegFlags) &&
    typeof settings.hwaccel === 'string' &&
    typeof settings.audioCodec === 'string' &&
    typeof settings.subtitleHandling === 'string'
  );
}

/**
 * Default license features for each tier
 */
export const DEFAULT_FEATURES: Record<string, LicenseFeatures> = {
  FREE: {
    multiNode: false,
    advancedPresets: false,
    api: false,
    priorityQueue: false,
    cloudStorage: false,
    webhooks: false,
  },
  PATREON: {
    multiNode: true,
    advancedPresets: true,
    api: true,
    priorityQueue: false,
    cloudStorage: false,
    webhooks: false,
  },
  COMMERCIAL_STARTER: {
    multiNode: true,
    advancedPresets: true,
    api: true,
    priorityQueue: true,
    cloudStorage: true,
    webhooks: true,
  },
  COMMERCIAL_PRO: {
    multiNode: true,
    advancedPresets: true,
    api: true,
    priorityQueue: true,
    cloudStorage: true,
    webhooks: true,
    qualityAnalysis: true,
    hardwareAcceleration: true,
  },
  COMMERCIAL_ENTERPRISE: {
    multiNode: true,
    advancedPresets: true,
    api: true,
    priorityQueue: true,
    cloudStorage: true,
    webhooks: true,
    qualityAnalysis: true,
    hardwareAcceleration: true,
    customBranding: true,
  },
};

/**
 * Default device profiles (maximum compatibility)
 */
export const DEFAULT_DEVICE_PROFILES: DeviceProfiles = {
  appleTv: true,
  roku: true,
  web: true,
  chromecast: true,
  ps5: true,
  xbox: true,
  fireTv: true,
  androidTv: true,
  smartTv: true,
};

/**
 * Default advanced settings
 */
export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
  ffmpegFlags: ['-preset', 'medium'],
  hwaccel: 'auto',
  audioCodec: 'copy',
  subtitleHandling: 'copy',
};

/**
 * Helper function to merge partial device profiles with defaults
 */
export function mergeDeviceProfiles(
  custom: Partial<DeviceProfiles>
): DeviceProfiles {
  return {
    ...DEFAULT_DEVICE_PROFILES,
    ...custom,
  };
}

/**
 * Helper function to merge partial advanced settings with defaults
 */
export function mergeAdvancedSettings(
  custom: Partial<AdvancedSettings>
): AdvancedSettings {
  return {
    ...DEFAULT_ADVANCED_SETTINGS,
    ...custom,
  };
}

/**
 * Calculate total percentage from codec distribution
 */
export function totalCodecPercentage(distribution: CodecDistribution): number {
  return Object.values(distribution).reduce((sum, value) => sum + value, 0);
}

/**
 * Get the dominant codec from distribution
 */
export function getDominantCodec(distribution: CodecDistribution): string | null {
  const entries = Object.entries(distribution);
  if (entries.length === 0) return null;

  return entries.reduce((max, [codec, count]) =>
    count > max[1] ? [codec, count] : max
  )[0];
}

/**
 * Format bytes to human-readable string
 * Useful for displaying savedBytes and file sizes
 */
export function formatBytes(bytes: bigint | number): string {
  const value = typeof bytes === 'bigint' ? Number(bytes) : bytes;

  if (value === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(value) / Math.log(k));

  return `${parseFloat((value / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format seconds to human-readable duration
 * Useful for displaying etaSeconds and uptimeSeconds
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
