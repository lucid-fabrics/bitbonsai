import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StorageProtocol, StorageShare, StorageShareStatus } from '@prisma/client';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import { promisify } from 'util';
import { type IStorageShareRepository } from '../repositories/storage-share.repository.interface';
import { escapeShellArg, sanitizePath, sanitizeServerAddress } from '../utils/input-sanitizer';
import { MountStrategyFactory } from './strategies/mount-strategy.factory';

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
 * Executes system commands to mount NFS/SMB shares.
 * Uses IStorageShareRepository directly to avoid circular dependency with StorageShareService.
 */
@Injectable()
export class StorageMountService {
  private readonly logger = new Logger(StorageMountService.name);

  constructor(
    private readonly strategyFactory: MountStrategyFactory,
    @Inject('IStorageShareRepository')
    private readonly repository: IStorageShareRepository
  ) {}

  /**
   * Mount a storage share
   */
  async mount(shareId: string): Promise<MountResult> {
    this.logger.log(`Mounting storage share: ${shareId}`);

    const share = await this.findShareOrThrow(shareId);

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

      // Get appropriate strategy for protocol
      const strategy = this.strategyFactory.getStrategy(share.protocol);

      // Build mount command using strategy
      const mountCommand = await strategy.buildMountCommand(share);

      this.logger.debug(`Executing mount command: ${mountCommand}`);

      // Execute mount command
      const { stderr } = await execAsync(mountCommand);

      if (stderr && !stderr.includes('warning')) {
        this.logger.warn(`Mount stderr: ${stderr}`);
      }

      // Verify mount was successful
      const isMounted = await this.verifyMount(share.mountPoint);

      if (!isMounted) {
        throw new Error('Mount verification failed - share not accessible');
      }

      // Update share status via repository
      await this.repository.updateStatus(shareId, StorageShareStatus.MOUNTED);

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

      // Update share status to error via repository
      await this.repository.updateStatus(shareId, StorageShareStatus.ERROR, errorMessage);

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
  async unmount(shareId: string, force = false): Promise<MountResult> {
    this.logger.log(`Unmounting storage share: ${shareId}`);

    const share = await this.findShareOrThrow(shareId);

    // Check if already unmounted
    if (!share.isMounted) {
      return {
        success: true,
        message: 'Share is already unmounted',
      };
    }

    try {
      // Sanitize mount point to prevent command injection
      const safeMountPoint = escapeShellArg(sanitizePath(share.mountPoint));

      // Build unmount command
      const unmountCommand = force ? `umount -f ${safeMountPoint}` : `umount ${safeMountPoint}`;

      this.logger.debug(`Executing unmount command: ${unmountCommand}`);

      // Execute unmount command
      const { stderr } = await execAsync(unmountCommand);

      if (stderr && !stderr.includes('warning')) {
        this.logger.warn(`Unmount stderr: ${stderr}`);
      }

      // Verify unmount was successful
      const isMounted = await this.verifyMount(share.mountPoint);

      if (isMounted) {
        throw new Error('Unmount verification failed - share still mounted');
      }

      // Update share status via repository
      await this.repository.updateStatus(shareId, StorageShareStatus.UNMOUNTED);

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
      // Sanitize server address to prevent command injection
      const safeServerAddress = sanitizeServerAddress(serverAddress);

      // Test basic reachability with ping
      const startTime = Date.now();
      const { stdout } = await execAsync(`ping -c 1 -W 2 ${escapeShellArg(safeServerAddress)}`);
      const endTime = Date.now();

      result.isReachable = stdout.includes('1 received') || stdout.includes('1 packets received');
      result.latencyMs = endTime - startTime;

      if (!result.isReachable) {
        result.error = 'Host unreachable';
        return result;
      }

      // Test NFS if protocol not specified or is NFS
      if (!protocol || protocol === StorageProtocol.NFS) {
        const nfsStrategy = this.strategyFactory.getStrategy(StorageProtocol.NFS);
        result.supportsNFS = await nfsStrategy.testConnectivity(serverAddress);
      }

      // Test SMB if protocol not specified or is SMB
      if (!protocol || protocol === StorageProtocol.SMB) {
        const smbStrategy = this.strategyFactory.getStrategy(StorageProtocol.SMB);
        result.supportsSMB = await smbStrategy.testConnectivity(serverAddress);
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
      // Sanitize mount point to prevent command injection
      const safeMountPoint = escapeShellArg(sanitizePath(mountPoint));
      const { stdout } = await execAsync(`df -B1 ${safeMountPoint}`);
      const lines = stdout.trim().split('\n');

      if (lines.length < 2) {
        throw new Error('Invalid df output');
      }

      // Parse df output (second line contains data)
      const parts = lines[1].split(/\s+/);
      const totalBytes = BigInt(parts[1]);
      // Note: usedBytes tracked for potential future use
      void parts[2]; // usedBytes - tracked for potential future use
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
      // Sanitize mount point to prevent command injection
      const safeMountPoint = sanitizePath(mountPoint);

      // Use grep with fixed-string mode (-F) to prevent regex injection
      const { stdout } = await execAsync(`mount | grep -F ${escapeShellArg(safeMountPoint)}`);
      return stdout.includes(safeMountPoint);
    } catch {
      return false;
    }
  }

  /**
   * Ensure mount point directory exists
   */
  private async ensureMountPoint(mountPoint: string): Promise<void> {
    try {
      await fs.access(mountPoint);
    } catch {
      // Directory doesn't exist, create it
      this.logger.debug(`Creating mount point directory: ${mountPoint}`);
      await fs.mkdir(mountPoint, { recursive: true, mode: 0o755 });
    }
  }

  /**
   * Add mount entry to /etc/fstab for persistence
   */
  private async addToFstab(share: StorageShare): Promise<void> {
    try {
      const fstabPath = '/etc/fstab';
      const fstabBackupPath = '/etc/fstab.backup';

      let fstabContent = '';
      try {
        fstabContent = await fs.readFile(fstabPath, 'utf-8');
      } catch {
        // fstab doesn't exist, will create it
        this.logger.debug('/etc/fstab does not exist, will create it');
      }

      // Sanitize mount point for comparison
      const safeMountPoint = sanitizePath(share.mountPoint);

      // Check if entry already exists using proper line matching
      // Match lines where the second field (mount point) equals our mount point
      const lines = fstabContent.split('\n');
      const alreadyExists = lines.some((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed) return false;
        const fields = trimmed.split(/\s+/);
        return fields.length >= 2 && fields[1] === safeMountPoint;
      });

      if (alreadyExists) {
        this.logger.debug(`Mount point ${safeMountPoint} already in fstab`);
        return;
      }

      // Create backup before modifying
      if (fstabContent) {
        await fs.writeFile(fstabBackupPath, fstabContent);
        this.logger.debug('Created fstab backup at /etc/fstab.backup');
      }

      // Get appropriate strategy and build fstab entry
      const strategy = this.strategyFactory.getStrategy(share.protocol);
      const fstabEntry = await strategy.buildFstabEntry(share);

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
  private async removeFromFstab(share: StorageShare): Promise<void> {
    try {
      const fstabPath = '/etc/fstab';
      const fstabBackupPath = '/etc/fstab.backup';
      const fstabContent = await fs.readFile(fstabPath, 'utf-8');

      // Sanitize mount point for comparison
      const safeMountPoint = sanitizePath(share.mountPoint);

      // Create backup before modifying
      await fs.writeFile(fstabBackupPath, fstabContent);
      this.logger.debug('Created fstab backup at /etc/fstab.backup');

      // Filter out lines where the second field (mount point) matches exactly
      // This prevents accidentally removing unrelated lines that happen to contain the path string
      const lines = fstabContent.split('\n');
      const filteredLines = lines.filter((line) => {
        const trimmed = line.trim();
        // Keep comments and empty lines
        if (trimmed.startsWith('#') || !trimmed) return true;
        // Parse fields and check if mount point (field 2) matches
        const fields = trimmed.split(/\s+/);
        return fields.length < 2 || fields[1] !== safeMountPoint;
      });

      await fs.writeFile(fstabPath, filteredLines.join('\n'));

      this.logger.log(`✓ Removed ${share.name} from /etc/fstab`);
    } catch (error) {
      this.logger.error(
        `Failed to remove from fstab: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  /**
   * Find a storage share by ID or throw NotFoundException.
   * Uses the repository directly to avoid circular dependency with StorageShareService.
   */
  private async findShareOrThrow(shareId: string): Promise<StorageShare> {
    const share = await this.repository.findById(shareId);
    if (!share) {
      throw new NotFoundException(`Storage share ${shareId} not found`);
    }
    return share;
  }
}
