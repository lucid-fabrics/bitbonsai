import { Injectable, Logger } from '@nestjs/common';
import { NodeStatus } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeRepository } from '../../common/repositories/node.repository';
import type { NodeHealthDto } from '../dto/node-health.dto';
import type { QueueHealthDto } from '../dto/queue-health.dto';

@Injectable()
export class NodeHealthService {
  private readonly logger = new Logger(NodeHealthService.name);

  constructor(
    private readonly nodeRepository: NodeRepository,
    private readonly jobRepository: JobRepository
  ) {}

  async checkNodeHealth(): Promise<NodeHealthDto> {
    try {
      const nodes = await this.nodeRepository.findAllSummary();
      const total = nodes.length;
      const online = nodes.filter((node) => node.status === NodeStatus.ONLINE).length;
      return { total, online, offline: total - online };
    } catch (error: unknown) {
      this.logger.error('Node health check failed:', error);
      return { total: 0, online: 0, offline: 0 };
    }
  }

  async checkQueueHealth(): Promise<QueueHealthDto> {
    try {
      const [queued, encoding, completed, failed] = await Promise.all([
        this.jobRepository.countWhere({ stage: 'QUEUED' }),
        this.jobRepository.countWhere({ stage: 'ENCODING' }),
        this.jobRepository.countWhere({ stage: 'COMPLETED' }),
        this.jobRepository.countWhere({ stage: 'FAILED' }),
      ]);
      return { queued, encoding, completed, failed };
    } catch (error: unknown) {
      this.logger.error('Queue health check failed:', error);
      return { queued: 0, encoding: 0, completed: 0, failed: 0 };
    }
  }
}
