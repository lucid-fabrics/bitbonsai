import { Injectable, Logger } from '@nestjs/common';
import { type StorageShare } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  escapeShellArg,
  sanitizeMountOptions,
  sanitizePath,
  sanitizeServerAddress,
} from '../../utils/input-sanitizer';
import { type IMountStrategy } from './mount-strategy.interface';

const execAsync = promisify(exec);

/**
 * NFS-specific mount strategy implementation
 */
@Injectable()
export class NFSMountStrategy implements IMountStrategy {
  private readonly logger = new Logger(NFSMountStrategy.name);

  /**
   * Build NFS mount command with input sanitization
   */
  buildMountCommand(share: StorageShare): string {
    // Sanitize all inputs to prevent command injection
    const serverAddress = sanitizeServerAddress(share.serverAddress);
    const sharePath = sanitizePath(share.sharePath);
    const mountPoint = sanitizePath(share.mountPoint);
    const options = share.mountOptions
      ? sanitizeMountOptions(share.mountOptions)
      : 'ro,nolock,soft';

    const exportPath = `${serverAddress}:${sharePath}`;

    return `mount -t nfs -o ${options} ${escapeShellArg(exportPath)} ${escapeShellArg(mountPoint)}`;
  }

  /**
   * Build NFS fstab entry with sanitization
   */
  buildFstabEntry(share: StorageShare): string {
    const serverAddress = sanitizeServerAddress(share.serverAddress);
    const sharePath = sanitizePath(share.sharePath);
    const mountPoint = sanitizePath(share.mountPoint);
    const exportPath = `${serverAddress}:${sharePath}`;
    const options = share.mountOptions
      ? sanitizeMountOptions(share.mountOptions)
      : 'ro,nolock,soft';

    return `${exportPath} ${mountPoint} nfs ${options} 0 0`;
  }

  /**
   * Test if server supports NFS protocol
   */
  async testConnectivity(serverAddress: string): Promise<boolean> {
    try {
      // Sanitize server address to prevent command injection
      const safeServerAddress = sanitizeServerAddress(serverAddress);
      const { stdout } = await execAsync(`showmount -e ${escapeShellArg(safeServerAddress)} 2>&1`);
      return !stdout.includes('RPC') && !stdout.includes('error');
    } catch (error: unknown) {
      this.logger.debug(
        `NFS connectivity test failed: ${error instanceof Error ? error.message : 'unknown error'}`
      );
      return false;
    }
  }
}
