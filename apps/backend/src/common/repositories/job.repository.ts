import { Injectable } from '@nestjs/common';
import { type Job, type JobStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from './base.repository';

@Injectable()
export class JobRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma, 'job');
  }

  async findById(id: string): Promise<Job | null> {
    return this.findUnique<Job | null>({ where: { id } });
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
}
