/**
 * System Settings Interface
 *
 * Typed interface for Settings model to eliminate 'as any' type assertions.
 * Must match Prisma Settings model schema.
 */
export interface SystemSettings {
  id: string;
  isSetupComplete: boolean;
  allowLocalNetworkWithoutAuth: boolean;
  defaultQueueView: string;
  readyFilesCacheTtlMinutes: number;
  maxAutoHealRetries: number;

  // ============ License Settings ============
  licenseKey?: string | null;
  licenseLastVerified?: Date | null;

  // ============ Notification Settings ============
  // Discord webhook
  discordWebhookUrl?: string | null;
  discordNotifyOnComplete: boolean;
  discordNotifyOnFail: boolean;
  discordNotifyOnBatch: boolean;

  // Slack webhook
  slackWebhookUrl?: string | null;
  slackNotifyOnComplete: boolean;
  slackNotifyOnFail: boolean;
  slackNotifyOnBatch: boolean;

  // Generic webhook
  webhookUrl?: string | null;
  webhookSecret?: string | null;

  // SMTP Email
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure: boolean;
  smtpUser?: string | null;
  smtpPass?: string | null;
  emailFrom?: string | null;
  emailTo?: string | null;
  emailDigestEnabled: boolean;
  emailDigestTime?: string | null;

  // ============ Integration Settings ============
  // Plex
  plexUrl?: string | null;
  plexToken?: string | null;
  plexPauseDuringPlayback: boolean;
  plexRefreshOnComplete: boolean;

  // Jellyfin
  jellyfinUrl?: string | null;
  jellyfinApiKey?: string | null;
  jellyfinRefreshOnComplete: boolean;

  // Torrent client
  torrentClient?: string | null;
  torrentUrl?: string | null;
  torrentUsername?: string | null;
  torrentPassword?: string | null;
  skipSeeding: boolean;

  // Radarr
  radarrUrl?: string | null;
  radarrApiKey?: string | null;
  radarrRescanOnComplete: boolean;
  radarrSkipQualityMet: boolean;

  // Sonarr
  sonarrUrl?: string | null;
  sonarrApiKey?: string | null;
  sonarrRescanOnComplete: boolean;
  sonarrSkipQualityMet: boolean;

  // Whisparr
  whisparrUrl?: string | null;
  whisparrApiKey?: string | null;
  whisparrRescanOnComplete: boolean;
  whisparrSkipQualityMet: boolean;

  // ============ Operational Settings ============
  jobStuckThresholdMinutes: number;
  jobEncodingTimeoutHours: number;
  recoveryIntervalMs: number;
  healthCheckTimeoutMin: number;
  encodingTimeoutMin: number;
  verifyingTimeoutMin: number;

  // Health check worker
  healthCheckConcurrency: number;
  healthCheckIntervalMs: number;
  maxRetryAttempts: number;

  // Backup cleanup worker
  backupCleanupIntervalMs: number;
  backupRetentionHours: number;

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}
