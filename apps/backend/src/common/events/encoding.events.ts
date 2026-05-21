/**
 * Event types for decoupling encoding ↔ queue circular dependencies.
 *
 * FfmpegService emits these events instead of calling QueueService directly.
 * QueueService listens via @OnEvent decorators.
 */

/** Fired when encoding progress updates need to be persisted */
export class EncodingProgressUpdateEvent {
  static readonly event = 'encoding.progress-update' as const;

  constructor(
    public readonly jobId: string,
    public readonly data: {
      progress: number;
      etaSeconds: number;
      fps: number;
      resumeTimestamp?: string;
      tempFilePath?: string;
    }
  ) {}
}

/** Fired when encoding preview paths need to be updated on a job */
export class EncodingPreviewUpdateEvent {
  static readonly event = 'encoding.preview-update' as const;

  constructor(
    public readonly jobId: string,
    public readonly previewPaths: string[]
  ) {}
}

/** Fired when an encoding job fails */
export class EncodingFailedEvent {
  static readonly event = 'encoding.failed' as const;

  constructor(
    public readonly jobId: string,
    public readonly errorMessage: string
  ) {}
}

/** Fired when an encoding job is cancelled by ffmpeg */
export class EncodingCancelledEvent {
  static readonly event = 'encoding.cancelled' as const;

  constructor(public readonly jobId: string) {}
}

/** Fired when ffmpeg needs to check/mark pause/cancel as processed */
export class EncodingProcessMarkedEvent {
  static readonly event = 'encoding.process-marked' as const;

  constructor(
    public readonly jobId: string,
    public readonly updates: Record<string, Date>
  ) {}
}
