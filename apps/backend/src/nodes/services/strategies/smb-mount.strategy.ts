import { Injectable, Logger } from '@nestjs/common';
import { type StorageShare } from '@prisma/client';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import { promisify } from 'util';
import { EncryptionService } from '../../../core/services/encryption.service';
import {
  escapeShellArg,
  sanitizeMountOptions,
  sanitizePath,
  sanitizeServerAddress,
} from '../../utils/input-sanitizer';
import { type IMountStrategy } from './mount-strategy.interface';

const execAsync = promisify(exec);

/**
 * SMB/CIFS-specific mount strategy implementation
 */
@Injectable()
export class SMBMountStrategy implements IMountStrategy {
  private readonly logger = new Logger(SMBMountStrategy.name);

  constructor(private readonly encryptionService: EncryptionService) {}

  /**
   * Build SMB/CIFS mount command using credential files (secure)
   */
  async buildMountCommand(share: StorageShare): Promise<string> {
    // Sanitize all inputs to prevent command injection
    const serverAddress = sanitizeServerAddress(share.serverAddress);
    const sharePath = share.sharePath.replace(/[;&|`$()<>'"\\!{}[\]*?~]/g, '');
    const mountPoint = sanitizePath(share.mountPoint);

    const options: string[] = [];

    // Use credential file for security (prevents password exposure in process list)
    if (share.smbUsername && share.smbPassword) {
      const credsFile = `/tmp/smb-creds-${share.id}`;

      // Decrypt password from database (with backward compatibility for plain text)
      const decryptedPassword = this.encryptionService.isEncrypted(share.smbPassword)
        ? this.encryptionService.decrypt(share.smbPassword)
        : share.smbPassword; // Backward compat: plain text password

      // Write credentials to temporary file with restricted permissions
      await fs.writeFile(
        credsFile,
        `username=${share.smbUsername}\npassword=${decryptedPassword}`,
        { mode: 0o600 } // Owner read/write only
      );

      options.push(`credentials=${credsFile}`);

      // Schedule credential file cleanup after mount
      setTimeout(async () => {
        try {
          await fs.unlink(credsFile);
        } catch (error) {
          this.logger.warn(`Failed to cleanup credential file ${credsFile}`);
        }
      }, 30000); // 30 seconds
    }

    if (share.smbDomain) {
      options.push(`domain=${share.smbDomain}`);
    }

    // Add SMB version
    if (share.smbVersion) {
      options.push(`vers=${share.smbVersion}`);
    }

    // Add read-only if configured
    if (share.readOnly) {
      options.push('ro');
    } else {
      options.push('rw');
    }

    // Add custom mount options (sanitized)
    if (share.mountOptions) {
      options.push(sanitizeMountOptions(share.mountOptions));
    }

    const optionsStr = options.join(',');
    const uncPath = `//${serverAddress}/${sharePath}`;

    return `mount -t cifs -o ${optionsStr} ${escapeShellArg(uncPath)} ${escapeShellArg(mountPoint)}`;
  }

  /**
   * Build SMB/CIFS fstab entry using credential files
   */
  async buildFstabEntry(share: StorageShare): Promise<string> {
    const serverAddress = sanitizeServerAddress(share.serverAddress);
    const sharePath = share.sharePath.replace(/[;&|`$()<>'"\\!{}[\]*?~]/g, '');
    const mountPoint = sanitizePath(share.mountPoint);
    const uncPath = `//${serverAddress}/${sharePath}`;
    const options: string[] = [];

    // For fstab, use persistent credentials file
    if (share.smbUsername && share.smbPassword) {
      const credsDir = '/etc/bitbonsai';
      const credsFile = `${credsDir}/smb-credentials-${share.id}`;

      // Ensure directory exists
      await fs.mkdir(credsDir, { recursive: true, mode: 0o755 });

      // Decrypt password (with backward compatibility for plain text)
      const decryptedPassword = this.encryptionService.isEncrypted(share.smbPassword)
        ? this.encryptionService.decrypt(share.smbPassword)
        : share.smbPassword; // Backward compat: plain text password

      // Write credentials file with restricted permissions
      await fs.writeFile(
        credsFile,
        `username=${share.smbUsername}\npassword=${decryptedPassword}`,
        { mode: 0o600 } // Owner read/write only
      );

      options.push(`credentials=${credsFile}`);
    }

    if (share.smbVersion) {
      options.push(`vers=${share.smbVersion}`);
    }

    if (share.readOnly) {
      options.push('ro');
    } else {
      options.push('rw');
    }

    if (share.mountOptions) {
      options.push(sanitizeMountOptions(share.mountOptions));
    }

    const optionsStr = options.join(',');

    return `${uncPath} ${mountPoint} cifs ${optionsStr} 0 0`;
  }

  /**
   * Test if server supports SMB protocol
   */
  async testConnectivity(serverAddress: string): Promise<boolean> {
    try {
      // Use smbclient to list shares
      const { stdout } = await execAsync(`smbclient -L ${serverAddress} -N 2>&1`);
      return !stdout.includes('Connection') && !stdout.includes('error');
    } catch (error) {
      this.logger.debug(
        `SMB connectivity test failed: ${error instanceof Error ? error.message : 'unknown error'}`
      );
      return false;
    }
  }
}
