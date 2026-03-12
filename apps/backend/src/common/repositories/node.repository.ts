import { Injectable } from '@nestjs/common';
import { type Node, type NodeRole, type NodeStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from './base.repository';

interface NodeWithJobCount extends Node {
  _count: { jobs: number };
}

@Injectable()
export class NodeRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma, 'node');
  }

  async findById(id: string): Promise<Node | null> {
    return this.findUnique<Node | null>({ where: { id } });
  }

  async findOnline(): Promise<Node[]> {
    return this.findMany<Node>({
      where: { status: 'ONLINE' as NodeStatus },
    });
  }

  async findByRole(role: NodeRole): Promise<Node[]> {
    return this.findMany<Node>({
      where: { role },
    });
  }

  async findMain(): Promise<Node | null> {
    return this.findFirst<Node | null>({
      where: { role: 'MAIN' as NodeRole },
    });
  }

  async findLinked(): Promise<Node[]> {
    return this.findMany<Node>({
      where: { role: 'LINKED' as NodeRole },
    });
  }

  async updateStatus(id: string, status: NodeStatus): Promise<Node> {
    return this.update<Node>({
      where: { id },
      data: { status },
    });
  }

  async countOnline(): Promise<number> {
    return this.count({
      where: { status: 'ONLINE' as NodeStatus },
    });
  }

  async getNodeLoad(): Promise<{ nodeId: string; jobCount: number }[]> {
    const nodes = await this.findMany<NodeWithJobCount>({
      where: { status: 'ONLINE' as NodeStatus },
      include: {
        _count: {
          select: {
            jobs: {
              where: {
                stage: { in: ['ENCODING', 'QUEUED'] },
              },
            },
          },
        },
      },
    });

    return nodes.map((n) => ({
      nodeId: n.id,
      jobCount: n._count.jobs,
    }));
  }
}
