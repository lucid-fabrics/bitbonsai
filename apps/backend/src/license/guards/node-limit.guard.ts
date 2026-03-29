import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LicenseClientService } from '../license-client.service';

@Injectable()
export class NodeLimitGuard implements CanActivate {
  constructor(
    private readonly licenseClient: LicenseClientService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    const { maxNodes } = await this.licenseClient.getCurrentLimits();

    const activeNodeCount = await this.prisma.node.count({
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
