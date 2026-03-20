import { Injectable } from '@nestjs/common';
import { type Job, type JobStage, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from './base.repository';

export type JobStatusFields = Pick<
  Job,
  'pauseRequestedAt' | 'pauseProcessedAt' | 'cancelRequestedAt' | 'cancelProcessedAt'
>;

export type JobWithLibrary = Job & { library: { nodeId: string } };

@Injectable()
export class JobRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma, 'job');
  }

  async findById(id: string): Promise<Job | null> {
    return this.findUnique<Job | null>({ where: { id } });
  }

  async findByIdWithLibrary(id: string): Promise<JobWithLibrary | null> {
    return this.findUnique<JobWithLibrary | null>({
      where: { id },
      include: { library: { select: { nodeId: true } } },
    });
  }

  async findByStage(stage: JobStage): Promise<Job[]> {
    return this.findMany<Job>({ where: { stage } });
  }

  async findQueued(limit = 10): Promise<Job[]> {
    return this.findMany<Job>({
      where: { stage: 'QUEUED' as JobStage },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async findByLibraryId(libraryId: string): Promise<Job[]> {
    return this.findMany<Job>({ where: { libraryId } });
  }

  async findActiveForNode(
    nodeId: string,
    stages: JobStage[] = ['ENCODING' as JobStage, 'QUEUED' as JobStage, 'VERIFYING' as JobStage]
  ): Promise<Job[]> {
    return this.findMany<Job>({
      where: { nodeId, stage: { in: stages } },
      orderBy: { priority: 'desc' },
    });
  }

  async findQueuedAndEncodingForNode(nodeId: string): Promise<Job[]> {
    return this.findMany<Job>({
      where: {
        nodeId,
        stage: { in: ['QUEUED' as JobStage, 'ENCODING' as JobStage] },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findQueuedExcludingNode(excludeNodeId: string, limit: number): Promise<Job[]> {
    return this.findMany<Job>({
      where: {
        stage: 'QUEUED' as JobStage,
        nodeId: { not: excludeNodeId },
        OR: [{ stickyUntil: null }, { stickyUntil: { lt: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async findEligibleForRebalance(limit = 500): Promise<JobWithLibrary[]> {
    return this.findMany<JobWithLibrary>({
      where: {
        stage: 'QUEUED' as JobStage,
        OR: [{ stickyUntil: null }, { stickyUntil: { lt: new Date() } }],
      },
      include: { library: { select: { nodeId: true } } },
      take: limit,
    });
  }

  async findCompletedSince(since: Date, limit = 1000): Promise<Job[]> {
    return this.prisma.job.findMany({
      where: {
        stage: 'COMPLETED' as JobStage,
        completedAt: { gte: since },
        startedAt: { not: null },
        beforeSizeBytes: { gt: 0 },
      },
      select: {
        id: true,
        sourceCodec: true,
        targetCodec: true,
        beforeSizeBytes: true,
        startedAt: true,
        completedAt: true,
      },
      take: limit,
    }) as Promise<Job[]>;
  }

  async countByStage(): Promise<Record<JobStage, number>> {
    const result = await this.prisma.job.groupBy({
      by: ['stage'],
      _count: true,
    });

    const counts: Partial<Record<JobStage, number>> = {};
    for (const r of result) {
      counts[r.stage as JobStage] = r._count;
    }
    return counts as Record<JobStage, number>;
  }

  async countForNode(nodeId: string, stage: JobStage): Promise<number> {
    return this.count({ where: { nodeId, stage } });
  }

  async countForNodeStages(nodeId: string, stages: JobStage[]): Promise<number> {
    return this.count({ where: { nodeId, stage: { in: stages } } });
  }

  async countCompletedForNodeSince(nodeId: string, since: Date): Promise<number> {
    return this.count({
      where: { nodeId, stage: 'COMPLETED' as JobStage, completedAt: { gte: since } },
    });
  }

  async countLargeFilesForNode(nodeId: string, minSizeBytes: bigint): Promise<number> {
    return this.count({
      where: {
        nodeId,
        stage: { in: ['QUEUED' as JobStage, 'ENCODING' as JobStage] },
        beforeSizeBytes: { gt: minSizeBytes },
      },
    });
  }

  async countByLibraryAndNode(nodeId: string, libraryId: string): Promise<number> {
    return this.count({
      where: {
        nodeId,
        libraryId,
        stage: { in: ['QUEUED' as JobStage, 'ENCODING' as JobStage] },
      },
    });
  }

  async atomicUpdateMany(
    where: Prisma.JobWhereInput,
    data: Prisma.JobUncheckedUpdateInput
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.job.updateMany({ where, data });
  }

  async updateById(id: string, data: Prisma.JobUncheckedUpdateInput): Promise<Job> {
    return this.update<Job>({ where: { id }, data });
  }

  async updateProgress(id: string, progress: number): Promise<Job> {
    return this.update<Job>({
      where: { id },
      data: { progress },
    });
  }

  async markCompleted(id: string, afterSizeBytes: bigint): Promise<Job> {
    return this.update<Job>({
      where: { id },
      data: {
        stage: 'COMPLETED' as JobStage,
        progress: 100,
        completedAt: new Date(),
        afterSizeBytes,
      },
    });
  }

  async findFirstWhere(where: Prisma.JobWhereInput): Promise<Job | null> {
    return this.prisma.job.findFirst({ where });
  }

  async findFirstSelect<T>(
    where: Prisma.JobWhereInput,
    select: Prisma.JobSelect
  ): Promise<T | null> {
    return this.prisma.job.findFirst({ where, select }) as Promise<T | null>;
  }

  async findUniqueSelect<T>(
    where: Prisma.JobWhereUniqueInput,
    select: Prisma.JobSelect
  ): Promise<T | null> {
    return this.prisma.job.findUnique({ where, select }) as Promise<T | null>;
  }

  async findUniqueWithInclude<T>(id: string, include: Prisma.JobInclude): Promise<T | null> {
    return this.prisma.job.findUnique({ where: { id }, include }) as Promise<T | null>;
  }

  async findManyWithInclude<T>(args: Prisma.JobFindManyArgs): Promise<T[]> {
    return this.prisma.job.findMany(args) as Promise<T[]>;
  }

  async countWhere(where: Prisma.JobWhereInput): Promise<number> {
    return this.prisma.job.count({ where });
  }

  async aggregateSumWhere(
    where: Prisma.JobWhereInput,
    _sum: Prisma.JobSumAggregateInputType
  ): Promise<{ _sum: Record<string, bigint | null> }> {
    return this.prisma.job.aggregate({ where, _sum }) as Promise<{
      _sum: Record<string, bigint | null>;
    }>;
  }

  async findManyCount(args: Prisma.JobFindManyArgs): Promise<[Job[], number]> {
    const countArgs: Prisma.JobCountArgs = {};
    if (args.where) countArgs.where = args.where;
    return Promise.all([
      this.prisma.job.findMany(args) as Promise<Job[]>,
      this.prisma.job.count(countArgs),
    ]);
  }

  async createJob(data: Prisma.JobUncheckedCreateInput): Promise<Job> {
    return this.prisma.job.create({ data });
  }

  async deleteManyWhere(where: Prisma.JobWhereInput): Promise<Prisma.BatchPayload> {
    return this.prisma.job.deleteMany({ where });
  }

  async deleteById(id: string): Promise<Job> {
    return this.prisma.job.delete({ where: { id } });
  }

  async findStatusFields(id: string): Promise<JobStatusFields | null> {
    return this.prisma.job.findUnique({
      where: { id },
      select: {
        pauseRequestedAt: true,
        pauseProcessedAt: true,
        cancelRequestedAt: true,
        cancelProcessedAt: true,
      },
    }) as Promise<JobStatusFields | null>;
  }

  async updateRaw(id: string, data: Record<string, unknown>): Promise<Job> {
    return this.prisma.job.update({ where: { id }, data }) as Promise<Job>;
  }

  async findManySelect<T>(where: Prisma.JobWhereInput, select: Prisma.JobSelect): Promise<T[]> {
    return this.prisma.job.findMany({ where, select }) as Promise<T[]>;
  }

  async updateByIdWithInclude<T>(
    id: string,
    data: Prisma.JobUncheckedUpdateInput,
    include: Prisma.JobInclude
  ): Promise<T> {
    return this.prisma.job.update({ where: { id }, data, include }) as unknown as Promise<T>;
  }

  async updateManyByIds(
    ids: string[],
    data: Prisma.JobUncheckedUpdateInput
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.job.updateMany({ where: { id: { in: ids } }, data });
  }

  async updateManyWhere(
    where: Prisma.JobWhereInput,
    data: Prisma.JobUncheckedUpdateInput
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.job.updateMany({ where, data });
  }

  async groupByStageCount(
    where: Prisma.JobWhereInput
  ): Promise<Array<{ stage: string; _count: number }>> {
    const result = await this.prisma.job.groupBy({
      by: ['stage'],
      where,
      _count: true,
    });
    return result.map((r) => ({ stage: r.stage, _count: r._count }));
  }

  async groupByNodeIdCount(
    where: Prisma.JobWhereInput
  ): Promise<Array<{ nodeId: string; _count: number }>> {
    const result = await this.prisma.job.groupBy({
      by: ['nodeId'],
      where,
      _count: { id: true },
    });
    return result.map((r) => ({ nodeId: r.nodeId, _count: (r._count as { id: number }).id ?? 0 }));
  }

  async groupByNodeIdSum(
    where: Prisma.JobWhereInput,
    _sum: Record<string, boolean>
  ): Promise<
    Array<{ nodeId: string; _count: { id: number }; _sum: Record<string, bigint | null> }>
  > {
    // Prisma groupBy requires type cast: strict return type not inferrable when _sum keys are dynamic
    return this.prisma.job.groupBy({
      by: ['nodeId'],
      where,
      _count: { id: true },
      _sum,
    } as unknown as Parameters<typeof this.prisma.job.groupBy>[0]) as unknown as Promise<
      Array<{ nodeId: string; _count: { id: number }; _sum: Record<string, bigint | null> }>
    >;
  }

  async groupByLibraryIdCount(
    where: Prisma.JobWhereInput
  ): Promise<Array<{ libraryId: string; _count: { id: number } }>> {
    // Prisma groupBy requires type cast: strict return type not inferrable for object-form _count
    return this.prisma.job.groupBy({
      by: ['libraryId'],
      where,
      _count: { id: true },
    } as unknown as Parameters<typeof this.prisma.job.groupBy>[0]) as unknown as Promise<
      Array<{ libraryId: string; _count: { id: number } }>
    >;
  }

  async groupByLibraryIdSum(
    where: Prisma.JobWhereInput,
    _sum: Record<string, boolean>
  ): Promise<Array<{ libraryId: string; _sum: Record<string, bigint | null> }>> {
    // Prisma groupBy requires type cast: strict return type not inferrable when _sum keys are dynamic
    return this.prisma.job.groupBy({ by: ['libraryId'], where, _sum } as unknown as Parameters<
      typeof this.prisma.job.groupBy
    >[0]) as unknown as Promise<Array<{ libraryId: string; _sum: Record<string, bigint | null> }>>;
  }

  async groupByTargetCodecAvg(
    where: Prisma.JobWhereInput
  ): Promise<
    Array<{ targetCodec: string; _avg: { savedPercent: number | null }; _count: number }>
  > {
    // Prisma groupBy requires type cast: strict return type not inferrable when mixing _avg and scalar _count
    return this.prisma.job.groupBy({
      by: ['targetCodec'],
      where,
      _avg: { savedPercent: true },
      _count: true,
    } as unknown as Parameters<typeof this.prisma.job.groupBy>[0]) as unknown as Promise<
      Array<{ targetCodec: string; _avg: { savedPercent: number | null }; _count: number }>
    >;
  }

  async aggregateWithAvgCount(
    where: Prisma.JobWhereInput
  ): Promise<{ _sum: { savedBytes: bigint | null }; _avg: { savedPercent: number | null } }> {
    return this.prisma.job.aggregate({
      where,
      _sum: { savedBytes: true },
      _avg: { savedPercent: true },
    }) as Promise<{ _sum: { savedBytes: bigint | null }; _avg: { savedPercent: number | null } }>;
  }

  async aggregateCount(where: Prisma.JobWhereInput): Promise<{ _count: { id: number } }> {
    return this.prisma.job.aggregate({ where, _count: { id: true } }) as Promise<{
      _count: { id: number };
    }>;
  }

  async findManyForNode(
    where: Prisma.JobWhereInput,
    select: Prisma.JobSelect,
    take: number
  ): Promise<Record<string, unknown>[]> {
    return this.prisma.job.findMany({ where, select, take, orderBy: { completedAt: 'desc' } });
  }
}
