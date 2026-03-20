import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { NodeRepository } from '../../common/repositories/node.repository';
import { LicenseClientService } from '../license-client.service';

@Injectable()
export class NodeLimitGuard implements CanActivate {
  constructor(
    private readonly licenseClient: LicenseClientService,
    private readonly nodeRepository: NodeRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { maxNodes } = await this.licenseClient.getCurrentLimits();

    const activeNodeCount = await this.nodeRepository.count({
      where: {
        status: { in: ['ONLINE', 'OFFLINE'] }, // Exclude ERROR nodes
      },
    });

    if (activeNodeCount >= maxNodes) {
      throw new ForbiddenException(
        `Node limit reached (${activeNodeCount}/${maxNodes}). Upgrade your license to add more nodes.`
      );
    }

    return true;
  }
}
