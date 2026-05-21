/**
 * Event types for decoupling library ↔ file-watcher circular dependencies.
 *
 * LibrariesService emits these events instead of calling FileWatcherService directly.
 * FileWatcherService listens via @OnEvent decorators.
 */

/** Fired when a library's watcher should be enabled */
export class LibraryWatcherEnableEvent {
  static readonly event = 'library.watcher.enable' as const;

  constructor(public readonly libraryId: string) {}
}

/** Fired when a library's watcher should be disabled */
export class LibraryWatcherDisableEvent {
  static readonly event = 'library.watcher.disable' as const;

  constructor(public readonly libraryId: string) {}
}

/** Fired when a library's watcher should be stopped (library deleted) */
export class LibraryWatcherStopEvent {
  static readonly event = 'library.watcher.stop' as const;

  constructor(public readonly libraryId: string) {}
}
