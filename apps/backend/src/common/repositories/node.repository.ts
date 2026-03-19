import { Injectable } from '@nestjs/common';
import {
  type LicenseStatus,
  type LicenseTier,
  type MediaType,
  type Node,
  type NodeRole,
  type NodeStatus,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from './base.repository';

export interface NodeWithJobCount extends Node {
  _count: { jobs: number };
}

export interface NodeWithStats extends Node {
  license: {
    tier: LicenseTier;
    maxConcurrentJobs: number;
    maxNodes: number;
    status: LicenseStatus;
  } | null;
  libraries: {
    id: string;
    name: string;
    totalFiles: number;
    totalSizeBytes: bigint;
    mediaType: MediaType;
  }[];
  _count: { jobs: number };
}

interface NodeWithMetrics extends Node {
  metrics: {
    jobsCompleted: number;
    jobsFailed: number;
    totalSavedBytes: bigint;
    avgThroughputFilesPerHour: number;
  }[];
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
    return this.prisma.node.findFirst({ where: { role: 'MAIN' as NodeRole } });
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

  async findFirstNode(): Promise<Node | null> {
    return this.findFirst<Node | null>({});
  }

  async findFirstByRole(
    role: NodeRole,
    opts?: { orderBy?: Record<string, unknown> }
  ): Promise<Node | null> {
    return this.findFirst<Node | null>({
      where: { role },
      ...(opts?.orderBy && { orderBy: opts.orderBy }),
    });
  }

  async findFirstWithLicense(
    where: Record<string, unknown>
  ): Promise<(Node & { license: { key: string } }) | null> {
    return this.findFirst<(Node & { license: { key: string } }) | null>({
      where,
      include: { license: true },
    });
  }

  async findManyByIp(ipAddress: string): Promise<Node[]> {
    return this.findMany<Node>({
      where: { ipAddress },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findManyByRole(
    role: NodeRole,
    opts?: { orderBy?: Record<string, unknown> }
  ): Promise<Node[]> {
    return this.findMany<Node>({
      where: { role },
      ...(opts?.orderBy && { orderBy: opts.orderBy }),
    });
  }

  async findAllWithLicense(): Promise<Node[]> {
    return this.findMany<Node>({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      include: {
        license: {
          select: {
            id: true,
            tier: true,
            maxNodes: true,
            maxConcurrentJobs: true,
            status: true,
          },
        },
      },
    });
  }

  async findWithStats(id: string): Promise<NodeWithStats | null> {
    return this.findUnique<NodeWithStats | null>({
      where: { id },
      include: {
        license: {
          select: {
            tier: true,
            maxConcurrentJobs: true,
            maxNodes: true,
            status: true,
          },
        },
        libraries: {
          select: {
            id: true,
            name: true,
            totalFiles: true,
            totalSizeBytes: true,
            mediaType: true,
          },
        },
        _count: {
          select: {
            jobs: {
              where: {
                stage: { in: ['QUEUED', 'ENCODING', 'VERIFYING'] },
              },
            },
          },
        },
      },
    });
  }

  async findWithSelect<T = unknown>(
    id: string,
    select: Record<string, unknown>
  ): Promise<T | null> {
    return this.findUnique<T | null>({ where: { id }, select });
  }

  async findByApiKey(apiKey: string): Promise<Node | null> {
    return this.findUnique<Node | null>({ where: { apiKey } });
  }

  async createNode(data: Record<string, unknown>): Promise<Node> {
    return this.create<Node>({ data });
  }

  async updateData(id: string, data: Record<string, unknown>): Promise<Node> {
    return this.update<Node>({ where: { id }, data });
  }

  async deleteById(id: string): Promise<Node> {
    return this.delete<Node>({ where: { id } });
  }

  async findAllWithMetrics(where?: Record<string, unknown>): Promise<NodeWithMetrics[]> {
    return this.findMany<NodeWithMetrics>({
      ...(where && { where }),
      include: { metrics: true },
    });
  }

  // ---- Distribution-specific methods ----

  async findOnlineWithActiveJobCount(): Promise<NodeWithJobCount[]> {
    return this.findMany<NodeWithJobCount>({
      where: { status: 'ONLINE' as NodeStatus },
      include: {
        _count: {
          select: { jobs: { where: { stage: { in: ['ENCODING', 'VERIFYING'] } } } },
        },
      },
    });
  }

  async findOnlineWithAllJobCount(): Promise<NodeWithJobCount[]> {
    return this.findMany<NodeWithJobCount>({
      where: { status: 'ONLINE' as NodeStatus },
      include: {
        _count: {
          select: {
            jobs: { where: { stage: { in: ['QUEUED', 'ENCODING', 'VERIFYING'] } } },
          },
        },
      },
    });
  }

  async findByIdWithActiveJobCount(id: string): Promise<NodeWithJobCount | null> {
    return this.findUnique<NodeWithJobCount | null>({
      where: { id },
      include: {
        _count: {
          select: { jobs: { where: { stage: { in: ['ENCODING', 'VERIFYING'] } } } },
        },
      },
    });
  }

  async findOnlineIds(): Promise<{ id: string }[]> {
    return this.findMany<{ id: string }>({
      where: { status: 'ONLINE' as NodeStatus },
      select: { id: true },
    });
  }

  async findAllSummary(): Promise<
    (Pick<Node, 'id' | 'name' | 'status'> & { _count: { jobs: number } })[]
  > {
    return this.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        _count: { select: { jobs: true } },
      },
    }) as Promise<(Pick<Node, 'id' | 'name' | 'status'> & { _count: { jobs: number } })[]>;
  }

  async findLoadData(
    nodeId: string
  ): Promise<Pick<
    Node,
    'id' | 'lastHeartbeatLoad' | 'currentSystemLoad' | 'currentMemoryFreeGB' | 'cpuCores'
  > | null> {
    return this.findUnique({
      where: { id: nodeId },
      select: {
        id: true,
        lastHeartbeatLoad: true,
        currentSystemLoad: true,
        currentMemoryFreeGB: true,
        cpuCores: true,
      },
    }) as Promise<Pick<
      Node,
      'id' | 'lastHeartbeatLoad' | 'currentSystemLoad' | 'currentMemoryFreeGB' | 'cpuCores'
    > | null>;
  }

  async findAllLoadData(): Promise<
    Pick<
      Node,
      'id' | 'lastHeartbeatLoad' | 'currentSystemLoad' | 'currentMemoryFreeGB' | 'cpuCores'
    >[]
  > {
    return this.findMany({
      where: { status: 'ONLINE' as NodeStatus },
      select: {
        id: true,
        lastHeartbeatLoad: true,
        currentSystemLoad: true,
        currentMemoryFreeGB: true,
        cpuCores: true,
      },
    }) as Promise<
      Pick<
        Node,
        'id' | 'lastHeartbeatLoad' | 'currentSystemLoad' | 'currentMemoryFreeGB' | 'cpuCores'
      >[]
    >;
  }

  async findCapacityData(
    nodeId: string
  ): Promise<
    | (Pick<
        Node,
        | 'id'
        | 'name'
        | 'role'
        | 'maxWorkers'
        | 'cpuCores'
        | 'loadThresholdMultiplier'
        | 'estimatedFreeAt'
        | 'lastHeartbeatLoad'
        | 'currentSystemLoad'
        | 'currentMemoryFreeGB'
      > & { _count: { jobs: number } })
    | null
  > {
    return this.findUnique({
      where: { id: nodeId },
      select: {
        id: true,
        name: true,
        role: true,
        maxWorkers: true,
        cpuCores: true,
        loadThresholdMultiplier: true,
        estimatedFreeAt: true,
        lastHeartbeatLoad: true,
        currentSystemLoad: true,
        currentMemoryFreeGB: true,
        _count: {
          select: { jobs: { where: { stage: { in: ['ENCODING', 'VERIFYING'] } } } },
        },
      },
    }) as Promise<
      | (Pick<
          Node,
          | 'id'
          | 'name'
          | 'role'
          | 'maxWorkers'
          | 'cpuCores'
          | 'loadThresholdMultiplier'
          | 'estimatedFreeAt'
          | 'lastHeartbeatLoad'
          | 'currentSystemLoad'
          | 'currentMemoryFreeGB'
        > & { _count: { jobs: number } })
      | null
    >;
  }

  async aggregateMaxEncodingSpeed(): Promise<number> {
    const result = await this.prisma.node.aggregate({
      _max: { avgEncodingSpeed: true },
      where: { avgEncodingSpeed: { not: null } },
    });
    return result._max.avgEncodingSpeed ?? 0;
  }

  async updateById(id: string, data: Prisma.NodeUpdateInput): Promise<Node> {
    return this.update<Node>({ where: { id }, data });
  }

  async findManySelect<T>(
    where: Record<string, unknown>,
    select: Record<string, unknown>
  ): Promise<T[]> {
    return this.findMany<T>({ where, select });
  }

  async groupByStatusCount(): Promise<Array<{ status: NodeStatus; _count: { status: number } }>> {
    // Prisma groupBy requires type cast: strict return type not inferrable for object-form _count
    return this.prisma.node.groupBy({
      by: ['status'],
      _count: { status: true },
    } as unknown as Parameters<typeof this.prisma.node.groupBy>[0]) as unknown as Promise<
      Array<{ status: NodeStatus; _count: { status: number } }>
    >;
  }

  async findManyWithJobCountOrdered(): Promise<(Node & { _count: { jobs: number } })[]> {
    return this.prisma.node.findMany({
      include: { _count: { select: { jobs: true } } },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    }) as Promise<(Node & { _count: { jobs: number } })[]>;
  }

  async findFirstByIpAddresses(ipAddresses: string[]): Promise<Node | null> {
    return this.prisma.node.findFirst({ where: { ipAddress: { in: ipAddresses } } });
  }
}
