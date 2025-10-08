import { LogLevel } from './log-level.type';

export interface UpdateSystemSettings {
  ffmpegPath?: string;
  logLevel?: LogLevel;
  analyticsEnabled?: boolean;
  webhookUrl?: string;
}
