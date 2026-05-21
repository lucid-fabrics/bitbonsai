export interface ILicenseSettings {
  licenseKey?: string | null;
  licenseLastVerified?: Date | null;
}

export interface INotificationSettings {
  discordWebhookUrl?: string | null;
  discordNotifyOnComplete: boolean;
  discordNotifyOnFail: boolean;
  discordNotifyOnBatch: boolean;

  slackWebhookUrl?: string | null;
  slackNotifyOnComplete: boolean;
  slackNotifyOnFail: boolean;
  slackNotifyOnBatch: boolean;

  webhookUrl?: string | null;
  webhookSecret?: string | null;

  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure: boolean;
  smtpUser?: string | null;
  smtpPass?: string | null;
  emailFrom?: string | null;
  emailTo?: string | null;
  emailDigestEnabled: boolean;
  emailDigestTime?: string | null;
}

export interface IIntegrationSettings {
  plexUrl?: string | null;
  plexToken?: string | null;
  plexPauseDuringPlayback: boolean;
  plexRefreshOnComplete: boolean;

  jellyfinUrl?: string | null;
  jellyfinApiKey?: string | null;
  jellyfinRefreshOnComplete: boolean;

  torrentClient?: string | null;
  torrentUrl?: string | null;
  torrentUsername?: string | null;
  torrentPassword?: string | null;
  skipSeeding: boolean;

  radarrUrl?: string | null;
  radarrApiKey?: string | null;
  radarrRescanOnComplete: boolean;
  radarrSkipQualityMet: boolean;

  sonarrUrl?: string | null;
  sonarrApiKey?: string | null;
  sonarrRescanOnComplete: boolean;
  sonarrSkipQualityMet: boolean;

  whisparrUrl?: string | null;
  whisparrApiKey?: string | null;
  whisparrRescanOnComplete: boolean;
  whisparrSkipQualityMet: boolean;
}

export interface IOperationalSettings {
  jobStuckThresholdMinutes: number;
  jobEncodingTimeoutHours: number;
  recoveryIntervalMs: number;
  healthCheckTimeoutMin: number;
  encodingTimeoutMin: number;
  verifyingTimeoutMin: number;

  healthCheckConcurrency: number;
  healthCheckIntervalMs: number;
  maxRetryAttempts: number;

  backupCleanupIntervalMs: number;
  backupRetentionHours: number;
}

/**
 * Typed interface for Settings model. Composed from domain-scoped sub-interfaces.
 * Must match Prisma Settings model schema.
 */
export interface SystemSettings
  extends ILicenseSettings,
    INotificationSettings,
    IIntegrationSettings,
    IOperationalSettings {
  id: string;
  isSetupComplete: boolean;
  allowLocalNetworkWithoutAuth: boolean;
  defaultQueueView: string;
  readyFilesCacheTtlMinutes: number;
  maxAutoHealRetries: number;

  createdAt?: Date;
  updatedAt?: Date;
}
