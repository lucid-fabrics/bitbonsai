/**
 * Health Check Issue System
 *
 * Represents compatibility issues, warnings, and information detected during health checks.
 * Used to pause jobs at NEEDS_DECISION state and present users with clear options.
 */

export enum HealthCheckIssueCategory {
  CONTAINER = 'CONTAINER', // Container compatibility (AC3+MP4, DTS+MP4, etc.)
  AUDIO = 'AUDIO', // Audio issues (missing tracks, low quality, etc.)
  VIDEO = 'VIDEO', // Video quality concerns
  INTEGRITY = 'INTEGRITY', // File integrity issues (corruption, errors)
  RESOURCE = 'RESOURCE', // Resource/performance warnings
  POLICY = 'POLICY', // Policy optimization suggestions (codec already matches, etc.)
  SUBTITLE = 'SUBTITLE', // Subtitle/caption issues
  CODEC = 'CODEC', // Codec-related issues (already in target codec, etc.)
}

export enum HealthCheckIssueSeverity {
  BLOCKER = 'BLOCKER', // Must be resolved before encoding (e.g., AC3+MP4)
  WARNING = 'WARNING', // Should be reviewed but can proceed (e.g., low bitrate)
  INFO = 'INFO', // Good to know, educational (e.g., "better codec available")
}

/**
 * A suggested action the user can take to resolve a health check issue
 */
export interface HealthCheckSuggestedAction {
  id: string; // Unique identifier for this action (e.g., "use_mkv", "transcode_aac")
  label: string; // Short label for UI (e.g., "Use MKV Container")
  description: string; // Detailed explanation of what this action does
  impact: string; // What changes (e.g., "File extension changes to .mkv")
  recommended: boolean; // Is this the recommended solution?
  config?: Record<string, unknown>; // Optional: configuration to apply if selected
}

/**
 * A health check issue detected during file analysis
 */
export interface HealthCheckIssue {
  category: HealthCheckIssueCategory;
  severity: HealthCheckIssueSeverity;
  code: string; // Unique code (e.g., "AC3_MP4_INCOMPATIBLE", "DTS_MP4_INCOMPATIBLE")
  message: string; // User-friendly message (e.g., "AC3 audio is incompatible with MP4")
  technicalDetails: string; // Technical explanation for advanced users
  suggestedActions: HealthCheckSuggestedAction[];
  affectedStreams?: number[]; // Optional: which streams are affected (e.g., [1, 2, 3])
  metadata?: Record<string, unknown>; // Optional: additional context
}

/**
 * User's decision to resolve health check issues
 */
export interface HealthCheckDecision {
  issueCode: string; // Which issue this decision resolves
  selectedActionId: string; // Which action the user chose
  timestamp: Date; // When decision was made
  notes?: string; // Optional: user notes
}

/**
 * Complete decision data stored in job.decisionData JSON field
 */
export interface JobDecisionData {
  decisions: HealthCheckDecision[];
  autoApproved: boolean; // Was this auto-approved by system (e.g., "always use MKV")?
  resolvedAt: Date;
  resolvedBy?: string; // Optional: user ID if available
}
