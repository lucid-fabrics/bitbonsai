import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { NodeConfigService } from '../../core/services/node-config.service';
import { QueueJobOwnershipService } from '../services/queue-job-ownership.service';

/**
 * JobOwnershipGuard
 *
 * Validates that the current node owns the job before allowing PATCH updates.
 * Extracts job ID from route params and checks ownership via QueueJobOwnershipService.
 *
 * Allows update if:
 * 1. This is the MAIN node (admin access to any job)
 * 2. Job has no nodeId assigned yet (DETECTED/QUEUED before assignment)
 * 3. The current node ID matches the job's nodeId
 */
@Injectable()
export class JobOwnershipGuard implements CanActivate {
  private readonly logger = new Logger(JobOwnershipGuard.name);

  constructor(
    private readonly nodeConfig: NodeConfigService,
    private readonly jobOwnership: QueueJobOwnershipService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ params: { id?: string } }>();
    const jobId = request.params.id;

    if (!jobId) {
      return true;
    }

    const currentNodeId = this.nodeConfig.getNodeId();
    const isMainNode = this.nodeConfig.isMainNode();

    if (isMainNode) {
      return true;
    }

    try {
      const ownership = await this.jobOwnership.validateJobOwnership(jobId, 'update');
      const isJobOwner = !ownership.nodeId || ownership.nodeId === currentNodeId;

      if (!isJobOwner) {
        this.logger.warn(
          `Cross-node update rejected: Node ${currentNodeId} attempted to update job ${jobId} owned by node ${ownership.nodeId}`
        );
        throw new ForbiddenException(
          `Node ${currentNodeId} cannot update job ${jobId} - job is assigned to node ${ownership.nodeId}`
        );
      }

      return true;
    } catch (error: unknown) {
      if (error instanceof ForbiddenException) throw error;
      throw error;
    }
  }
}
