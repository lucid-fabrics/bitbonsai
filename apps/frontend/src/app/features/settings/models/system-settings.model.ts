import { DatabaseType } from './database-type.type';
import { LogLevel } from './log-level.enum';
import { StorageInfo } from './storage-info.model';

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
  advancedModeEnabled?: boolean;
}
