import { Injectable } from '@nestjs/common';
import { type NodeFailureLog, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from './base.repository';

export interface NodeFailureLogCreateData {
  nodeId: string;
  reason: string;
  errorCode?: string;
  stage: string;
  progress?: number | null;
  jobId?: string | null;
  filePath?: string | null;
  fileSize?: bigint | null;
}

@Injectable()
export class NodeFailureLogRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma, 'nodeFailureLog');
  }

  async createLog(data: NodeFailureLogCreateData): Promise<NodeFailureLog> {
    return this.prisma.nodeFailureLog.create({
      data: data as Prisma.NodeFailureLogUncheckedCreateInput,
    });
  }

  async countForNodeSince(nodeId: string, since: Date): Promise<number> {
    return this.count({ where: { nodeId, createdAt: { gte: since } } });
  }

  async findLastForNode(nodeId: string): Promise<Pick<NodeFailureLog, 'createdAt'> | null> {
    return this.findFirst<Pick<NodeFailureLog, 'createdAt'> | null>({
      where: { nodeId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
  }

  async findRecentForNode(
    nodeId: string,
    since: Date
  ): Promise<Pick<NodeFailureLog, 'reason' | 'createdAt'>[]> {
    return this.findMany<Pick<NodeFailureLog, 'reason' | 'createdAt'>>({
      where: { nodeId, createdAt: { gte: since } },
      select: { reason: true, createdAt: true },
    });
  }

  async deleteOlderThan(before: Date): Promise<Prisma.BatchPayload> {
    return this.deleteMany({ where: { createdAt: { lt: before } } });
  }
}
