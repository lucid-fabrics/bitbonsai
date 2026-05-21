/**
 * Event types for decoupling core ↔ nodes storage circular dependencies.
 *
 * StorageInitService emits these events instead of calling StorageShareService directly.
 * StorageShareService listens via @OnEvent decorators.
 */

/** Fired when a linked node needs to auto-detect and mount shares */
export class StorageAutoDetectMountEvent {
  static readonly event = 'storage.auto-detect-mount' as const;

  constructor(public readonly nodeId: string) {}
}
