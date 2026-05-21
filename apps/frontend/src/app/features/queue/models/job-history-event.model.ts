/**
 * Job History Event Types
 */
export enum JobEventType {
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  RESTARTED = 'RESTARTED',
  AUTO_HEALED = 'AUTO_HEALED',
  BACKEND_RESTART = 'BACKEND_RESTART',
  TIMEOUT = 'TIMEOUT',
}

/**
 * Job History Event Model
 *
 * Represents a single event in a job's failure/recovery history timeline.
 * Each event captures the state of the job when the event occurred.
 */
export interface JobHistoryEvent {
  /** Unique event ID */
  id: string;

  /** Type of event that occurred */
  eventType: JobEventType;

  /** Job stage when event occurred */
  stage: string;

  /** Progress percentage when event occurred (0-100) */
  progress: number;

  /** Error message if failed */
  errorMessage?: string;

  /** Additional error context/stack trace */
  errorDetails?: string;

  /** Was this a successful auto-heal? */
  wasAutoHealed: boolean;

  /** Did temp file exist during this event? */
  tempFileExists?: boolean;

  /** Which retry attempt was this? */
  retryNumber?: number;

  /** Who/what triggered this event */
  triggeredBy?: 'USER' | 'SYSTEM' | 'BACKEND_RESTART' | 'TIMEOUT' | 'MANUAL';

  /** User-friendly message explaining what happened */
  systemMessage?: string;

  /** Encoding speed at time of event */
  fps?: number;

  /** Estimated time remaining at time of event */
  etaSeconds?: number;

  /** If resumed, where it started from (in seconds) */
  startedFromSeconds?: number;

  /** When this event occurred */
  createdAt: string;
}
