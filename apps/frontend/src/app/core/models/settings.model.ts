export enum DatabaseType {
  SQLITE = 'SQLITE',
  POSTGRESQL = 'POSTGRESQL',
}

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface StorageInfo {
  usedGb: number;
  totalGb: number;
  usagePercent: number;
}

export interface SystemSettings {
  version: string;
  databaseType: DatabaseType;
  databasePath: string;
  storageInfo: StorageInfo;
  ffmpegPath: string;
  logLevel: LogLevel;
  analyticsEnabled: boolean;
  apiKey: string;
  webhookUrl?: string;
}

export interface UpdateSystemSettings {
  ffmpegPath?: string;
  logLevel?: LogLevel;
  analyticsEnabled?: boolean;
  webhookUrl?: string;
}

export interface HardwareAcceleration {
  nvidia: boolean;
  intelQsv: boolean;
  amd: boolean;
  appleVideoToolbox: boolean;
}

export interface SystemInfo {
  cpuCores: number;
  architecture: string;
  platform: string;
  totalMemoryGb: number;
  containerRuntime?: string;
  unraidVersion?: string;
}

export interface DefaultPaths {
  mediaPath: string;
  downloadsPath: string;
  configPath: string;
}

export interface EnvironmentInfo {
  environment: 'UNRAID' | 'DOCKER' | 'BARE_METAL';
  isUnraid: boolean;
  isDocker: boolean;
  hardwareAcceleration: HardwareAcceleration;
  defaultPaths: DefaultPaths;
  systemInfo: SystemInfo;
  docsLink: string;
  recommendations: string[];
}
