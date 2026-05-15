import { Injectable } from '@nestjs/common';
import { type JobEventType, type JobHistory, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from './base.repository';

@Injectable()
export class JobHistoryRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma, 'jobHistory');
  }

  async createEntry(data: Prisma.JobHistoryUncheckedCreateInput): Promise<JobHistory> {
    return this.prisma.jobHistory.create({ data });
  }

  async findManyByJobId(jobId: string): Promise<JobHistory[]> {
    return this.prisma.jobHistory.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countByJobId(jobId: string, eventTypes: JobEventType[]): Promise<number> {
    return this.prisma.jobHistory.count({
      where: {
        jobId,
        eventType: { in: eventTypes },
      },
    });
  }
}
