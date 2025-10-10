import { LogLevel } from './log-level.enum';

export interface UpdateSystemSettings {
  ffmpegPath?: string;
  logLevel?: LogLevel;
  analyticsEnabled?: boolean;
  webhookUrl?: string;
}
