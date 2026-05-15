import { Injectable } from '@nestjs/common';
import { StorageProtocol } from '@prisma/client';
import { type IMountStrategy } from './mount-strategy.interface';
import { NFSMountStrategy } from './nfs-mount.strategy';
import { SMBMountStrategy } from './smb-mount.strategy';

/**
 * Factory for creating protocol-specific mount strategies
 * Implements Factory Pattern to encapsulate strategy creation logic
 */
@Injectable()
export class MountStrategyFactory {
  constructor(
    private readonly nfsStrategy: NFSMountStrategy,
    private readonly smbStrategy: SMBMountStrategy
  ) {}

  /**
   * Get the appropriate mount strategy for a given protocol
   */
  getStrategy(protocol: StorageProtocol): IMountStrategy {
    switch (protocol) {
      case StorageProtocol.NFS:
        return this.nfsStrategy;
      case StorageProtocol.SMB:
        return this.smbStrategy;
      default:
        throw new Error(`Unsupported storage protocol: ${protocol}`);
    }
  }
}
