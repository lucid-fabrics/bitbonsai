import { type StorageShare } from '@prisma/client';

/**
 * Strategy interface for protocol-specific mount operations
 * Implements Strategy Pattern to handle NFS vs SMB mounting differences
 */
export interface IMountStrategy {
  /**
   * Build the mount command for this protocol
   */
  buildMountCommand(share: StorageShare): Promise<string> | string;

  /**
   * Build fstab entry for this protocol
   */
  buildFstabEntry(share: StorageShare): Promise<string> | string;

  /**
   * Test if the server supports this protocol
   */
  testConnectivity(serverAddress: string): Promise<boolean>;
}
