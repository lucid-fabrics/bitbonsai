/**
 * File Transport Abstraction Layer
 *
 * Allows swapping between different storage transport mechanisms:
 * - NFS (current): Direct kernel-level mounts
 * - HTTP Streaming (future): For cloud nodes
 * - gRPC Chunks (future): For distributed systems
 * - BeeGFS (future): For ultra-high performance
 *
 * The encoding pipeline doesn't care HOW files are accessed,
 * just that they're accessible.
 */

export enum FileTransportType {
  NFS = 'NFS',
  HTTP = 'HTTP',
  GRPC = 'GRPC',
  LOCAL = 'LOCAL',
}

export interface FileTransportConfig {
  type: FileTransportType;
  options?: Record<string, unknown>;
}

/**
 * Abstract interface for file access across the cluster
 */
export interface IFileTransport {
  /**
   * Get the local path to a file (may trigger download/mount)
   */
  getFilePath(mediaId: string): Promise<string>;

  /**
   * Check if a file exists
   */
  fileExists(path: string): Promise<boolean>;

  /**
   * Get file size in bytes
   */
  getFileSize(path: string): Promise<number>;

  /**
   * Stream file contents (for HTTP/gRPC implementations)
   */
  streamFile?(mediaId: string): Promise<NodeJS.ReadableStream>;

  /**
   * Cleanup/unmount temporary resources
   */
  cleanup?(): Promise<void>;
}

/**
 * Docker volume mount information
 */
export interface DockerVolumeMount {
  /** Host path (e.g., /mnt/user/media) */
  source: string;

  /** Container path (e.g., /media) */
  destination: string;

  /** Read-only mount */
  readOnly: boolean;

  /** Mount type (bind, volume, tmpfs) */
  type: string;
}

/**
 * Configuration for auto-managed storage shares
 */
export interface AutoManagedShareConfig {
  /** Docker volume mount info */
  volumeMount: DockerVolumeMount;

  /** Share name for display */
  name: string;

  /** Whether to export this volume */
  enabled: boolean;

  /** NFS export options */
  nfsOptions?: string;
}
