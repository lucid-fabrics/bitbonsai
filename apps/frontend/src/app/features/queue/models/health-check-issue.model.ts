export enum HealthCheckIssueCategory {
  CONTAINER = 'CONTAINER',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  INTEGRITY = 'INTEGRITY',
  RESOURCE = 'RESOURCE',
  POLICY = 'POLICY',
  SUBTITLE = 'SUBTITLE',
  CODEC = 'CODEC', // Codec-related issues (already in target codec, etc.)
}

export enum HealthCheckIssueSeverity {
  BLOCKER = 'BLOCKER',
  WARNING = 'WARNING',
  INFO = 'INFO',
}

export interface HealthCheckSuggestedAction {
  id: string;
  label: string;
  description: string;
  impact: string;
  recommended: boolean;
  config?: Record<string, unknown>;
}

export interface HealthCheckIssue {
  category: HealthCheckIssueCategory;
  severity: HealthCheckIssueSeverity;
  code: string;
  message: string;
  technicalDetails: string;
  suggestedActions: HealthCheckSuggestedAction[];
  affectedStreams?: number[];
  metadata?: Record<string, unknown>;
}
