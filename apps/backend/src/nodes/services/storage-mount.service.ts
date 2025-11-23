import {
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { StorageProtocol, StorageShareStatus } from '@prisma/client';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import { promisify } from 'util';
import { StorageShareService } from './storage-share.service';

const execAsync = promisify(exec);

export interface MountResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface ShareConnectivityTest {
  isReachable: boolean;
  supportsNFS: boolean;
  supportsSMB: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Service to handle physical mounting and unmounting of network shares
 * Executes system commands to mount NFS/SMB shares
 */
@Injectable()
export class StorageMountService {
  private readonly logger = new Logger(StorageMountService.name);

  constructor(
    @Inject(forwardRef(() => StorageShareService))
    private readonly storageShareService: StorageShareService
  ) {}

  /**
   * Mount a storage share
   */
  async mount(shareId: string): Promise<MountResult> {
    this.logger.log(`Mounting storage share: ${shareId}`);

    const share = await this.storageShareService.findOne(shareId);

    // Check if already mounted
    if (share.isMounted) {
      return {
        success: true,
        message: 'Share is already mounted',
      };
    }

    try {
      // Ensure mount point directory exists
      await this.ensureMountPoint(share.mountPoint);

      // Build mount command based on protocol
      const mountCommand =
        share.protocol === StorageProtocol.NFS
          ? this.buildNFSMountCommand(share)
          : this.buildSMBMountCommand(share);

      this.logger.debug(`Executing mount command: ${mountCommand}`);

      // Execute mount command
      const { stdout, stderr } = await execAsync(mountCommand);

      if (stderr && !stderr.includes('warning')) {
        this.logger.warn(`Mount stderr: ${stderr}`);
      }

      // Verify mount was successful
      const isMounted = await this.verifyMount(share.mountPoint);

      if (!isMounted) {
        throw new Error('Mount verification failed - share not accessible');
      }

      // Update share status
      await this.storageShareService.updateStatus(shareId, StorageShareStatus.MOUNTED);

      // Add to fstab if configured
      if (share.addToFstab) {
        await this.addToFstab(share);
      }

      this.logger.log(`✓ Successfully mounted ${share.name} at ${share.mountPoint}`);

      return {
        success: true,
        message: `Successfully mounted ${share.name}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during mount';
      this.logger.error(`Failed to mount ${share.name}: ${errorMessage}`);

      // Update share status to error
      await this.storageShareService.updateStatus(shareId, StorageShareStatus.ERROR, errorMessage);

      return {
        success: false,
        message: 'Mount failed',
        error: errorMessage,
      };
    }
  }

  /**
   * Unmount a storage share
   */
  async unmount(shareId: string, force: boolean = false): Promise<MountResult> {
    this.logger.log(`Unmounting storage share: ${shareId}`);

    const share = await this.storageShareService.findOne(shareId);

    // Check if already unmounted
    if (!share.isMounted) {
      return {
        success: true,
        message: 'Share is already unmounted',
      };
    }

    try {
      // Build unmount command
      const unmountCommand = force ? `umount -f ${share.mountPoint}` : `umount ${share.mountPoint}`;

      this.logger.debug(`Executing unmount command: ${unmountCommand}`);

      // Execute unmount command
      const { stdout, stderr } = await execAsync(unmountCommand);

      if (stderr && !stderr.includes('warning')) {
        this.logger.warn(`Unmount stderr: ${stderr}`);
      }

      // Verify unmount was successful
      const isMounted = await this.verifyMount(share.mountPoint);

      if (isMounted) {
        throw new Error('Unmount verification failed - share still mounted');
      }

      // Update share status
      await this.storageShareService.updateStatus(shareId, StorageShareStatus.UNMOUNTED);

      // Remove from fstab if it was added
      if (share.addToFstab) {
        await this.removeFromFstab(share);
      }

      this.logger.log(`✓ Successfully unmounted ${share.name}`);

      return {
        success: true,
        message: `Successfully unmounted ${share.name}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during unmount';
      this.logger.error(`Failed to unmount ${share.name}: ${errorMessage}`);

      return {
        success: false,
        message: 'Unmount failed',
        error: errorMessage,
      };
    }
  }

  /**
   * Remount a share (unmount then mount)
   */
  async remount(shareId: string): Promise<MountResult> {
    this.logger.log(`Remounting storage share: ${shareId}`);

    const unmountResult = await this.unmount(shareId, true);
    if (!unmountResult.success) {
      return unmountResult;
    }

    // Wait a moment before remounting
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return this.mount(shareId);
  }

  /**
   * Test connectivity to a storage server
   */
  async testConnectivity(
    serverAddress: string,
    protocol?: StorageProtocol
  ): Promise<ShareConnectivityTest> {
    this.logger.log(`Testing connectivity to ${serverAddress}`);

    const result: ShareConnectivityTest = {
      isReachable: false,
      supportsNFS: false,
      supportsSMB: false,
    };

    try {
      // Test basic reachability with ping
      const startTime = Date.now();
      const { stdout } = await execAsync(`ping -c 1 -W 2 ${serverAddress}`);
      const endTime = Date.now();

      result.isReachable = stdout.includes('1 received') || stdout.includes('1 packets received');
      result.latencyMs = endTime - startTime;

      if (!result.isReachable) {
        result.error = 'Host unreachable';
        return result;
      }

      // Test NFS if protocol not specified or is NFS
      if (!protocol || protocol === StorageProtocol.NFS) {
        try {
          const { stdout: nfsOutput } = await execAsync(`showmount -e ${serverAddress} 2>&1`);
          result.supportsNFS = !nfsOutput.includes('RPC') && !nfsOutput.includes('error');
        } catch (error) {
          this.logger.debug(
            `NFS test failed: ${error instanceof Error ? error.message : 'unknown error'}`
          );
        }
      }

      // Test SMB if protocol not specified or is SMB
      if (!protocol || protocol === StorageProtocol.SMB) {
        try {
          // Use smbclient to list shares
          const { stdout: smbOutput } = await execAsync(`smbclient -L ${serverAddress} -N 2>&1`);
          result.supportsSMB = !smbOutput.includes('Connection') && !smbOutput.includes('error');
        } catch (error) {
          this.logger.debug(
            `SMB test failed: ${error instanceof Error ? error.message : 'unknown error'}`
          );
        }
      }

      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Connectivity test failed';
      return result;
    }
  }

  /**
   * Get disk usage for a mounted share
   */
  async getDiskUsage(mountPoint: string): Promise<{
    totalBytes: bigint;
    availableBytes: bigint;
    usedPercent: number;
  }> {
    try {
      const { stdout } = await execAsync(`df -B1 ${mountPoint}`);
      const lines = stdout.trim().split('\n');

      if (lines.length < 2) {
        throw new Error('Invalid df output');
      }

      // Parse df output (second line contains data)
      const parts = lines[1].split(/\s+/);
      const totalBytes = BigInt(parts[1]);
      const _usedBytes = BigInt(parts[2]);
      const availableBytes = BigInt(parts[3]);
      const usedPercent = parseFloat(parts[4].replace('%', ''));

      return {
        totalBytes,
        availableBytes,
        usedPercent,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get disk usage for ${mountPoint}: ${error instanceof Error ? error.message : 'unknown error'}`
      );
      throw new InternalServerErrorException('Failed to get disk usage');
    }
  }

  /**
   * Verify if a mount point is actually mounted
   */
  private async verifyMount(mountPoint: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`mount | grep ${mountPoint}`);
      return stdout.includes(mountPoint);
    } catch (_error) {
      return false;
    }
  }

  /**
   * Ensure mount point directory exists
   */
  private async ensureMountPoint(mountPoint: string): Promise<void> {
    try {
      await fs.access(mountPoint);
    } catch (_error) {
      // Directory doesn't exist, create it
      this.logger.debug(`Creating mount point directory: ${mountPoint}`);
      await fs.mkdir(mountPoint, { recursive: true, mode: 0o755 });
    }
  }

  /**
   * Build NFS mount command
   */
  private buildNFSMountCommand(share: any): string {
    const options = share.mountOptions || 'ro,nolock,soft';
    const exportPath = `${share.serverAddress}:${share.sharePath}`;

    return `mount -t nfs -o ${options} ${exportPath} ${share.mountPoint}`;
  }

  /**
   * Build SMB/CIFS mount command
   */
  private buildSMBMountCommand(share: any): string {
    const options: string[] = [];

    // Add credentials
    if (share.smbUsername) {
      options.push(`username=${share.smbUsername}`);
    }
    if (share.smbPassword) {
      options.push(`password=${share.smbPassword}`);
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

    // Add custom mount options
    if (share.mountOptions) {
      options.push(share.mountOptions);
    }

    const optionsStr = options.join(',');
    const uncPath = `//${share.serverAddress}/${share.sharePath}`;

    return `mount -t cifs -o ${optionsStr} ${uncPath} ${share.mountPoint}`;
  }

  /**
   * Add mount entry to /etc/fstab for persistence
   */
  private async addToFstab(share: any): Promise<void> {
    try {
      const fstabPath = '/etc/fstab';
      const fstabContent = await fs.readFile(fstabPath, 'utf-8');

      // Check if entry already exists
      if (fstabContent.includes(share.mountPoint)) {
        this.logger.debug(`Mount point ${share.mountPoint} already in fstab`);
        return;
      }

      // Build fstab entry
      const fstabEntry =
        share.protocol === StorageProtocol.NFS
          ? this.buildNFSFstabEntry(share)
          : this.buildSMBFstabEntry(share);

      // Append to fstab
      await fs.appendFile(fstabPath, `\n${fstabEntry}\n`);

      this.logger.log(`✓ Added ${share.name} to /etc/fstab`);
    } catch (error) {
      this.logger.error(
        `Failed to add to fstab: ${error instanceof Error ? error.message : 'unknown error'}`
      );
      // Don't throw - mounting succeeded, fstab is optional
    }
  }

  /**
   * Remove mount entry from /etc/fstab
   */
  private async removeFromFstab(share: any): Promise<void> {
    try {
      const fstabPath = '/etc/fstab';
      const fstabContent = await fs.readFile(fstabPath, 'utf-8');

      // Filter out lines containing this mount point
      const lines = fstabContent.split('\n');
      const filteredLines = lines.filter(
        (line) => !line.includes(share.mountPoint) || line.trim().startsWith('#')
      );

      await fs.writeFile(fstabPath, filteredLines.join('\n'));

      this.logger.log(`✓ Removed ${share.name} from /etc/fstab`);
    } catch (error) {
      this.logger.error(
        `Failed to remove from fstab: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  /**
   * Build NFS fstab entry
   */
  private buildNFSFstabEntry(share: any): string {
    const exportPath = `${share.serverAddress}:${share.sharePath}`;
    const options = share.mountOptions || 'ro,nolock,soft';

    return `${exportPath} ${share.mountPoint} nfs ${options} 0 0`;
  }

  /**
   * Build SMB/CIFS fstab entry
   */
  private buildSMBFstabEntry(share: any): string {
    const uncPath = `//${share.serverAddress}/${share.sharePath}`;
    const options: string[] = [];

    // For fstab, use credentials file instead of inline password
    if (share.smbUsername) {
      const credsFile = `/etc/bitbonsai/smb-credentials-${share.id}`;
      options.push(`credentials=${credsFile}`);
      // Note: Credentials file creation should be handled separately
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
      options.push(share.mountOptions);
    }

    const optionsStr = options.join(',');

    return `${uncPath} ${share.mountPoint} cifs ${optionsStr} 0 0`;
  }
}
