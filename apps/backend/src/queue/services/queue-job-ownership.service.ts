import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeConfigService } from '../../core/services/node-config.service';

/**
 * QueueJobOwnershipService
 *
 * Handles job ownership validation and file-path security checks.
 * Extracted from QueueJobCrudService to separate security concerns.
 */
@Injectable()
export class QueueJobOwnershipService {
  private readonly logger = new Logger(QueueJobOwnershipService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly nodeConfig: NodeConfigService
  ) {}

  /**
   * Validate job ownership with optimistic locking support
   */
  async validateJobOwnership(
    jobId: string,
    operation: string,
    callerNodeId?: string
  ): Promise<{ nodeId: string | null; updatedAt: Date }> {
    const currentNodeId = this.nodeConfig.getNodeId();
    const isMainNode = this.nodeConfig.isMainNode();

    if (!currentNodeId) {
      const job = await this.jobRepository.findUniqueSelect<{
        nodeId: string | null;
        updatedAt: Date;
      }>({ id: jobId }, { nodeId: true, updatedAt: true });
      if (!job) throw new NotFoundException(`Job ${jobId} not found`);
      return job;
    }

    const job = await this.jobRepository.findUniqueSelect<{
      nodeId: string | null;
      fileLabel: string;
      updatedAt: Date;
    }>({ id: jobId }, { nodeId: true, fileLabel: true, updatedAt: true });

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    // LINKED node: check caller matches job owner
    if (!isMainNode && job.nodeId && job.nodeId !== currentNodeId) {
      this.logger.error(
        `Cross-node ${operation} rejected: ` +
          `Node ${currentNodeId} attempted to modify job ${jobId} owned by ${job.nodeId} (${job.fileLabel})`
      );
      throw new ForbiddenException(
        `Node ${currentNodeId} cannot ${operation} job ${jobId} - job is assigned to node ${job.nodeId}`
      );
    }

    // MAIN node receiving proxied call: validate the caller node owns this job.
    // callerNodeId comes from the x-node-id header set by LINKED proxy calls.
    // User-initiated actions won't include this header (callerNodeId undefined) and are always allowed.
    if (isMainNode && callerNodeId && job.nodeId && job.nodeId !== callerNodeId) {
      this.logger.error(
        `Cross-node ${operation} rejected on MAIN: ` +
          `LINKED node ${callerNodeId} attempted to modify job ${jobId} owned by ${job.nodeId} (${job.fileLabel})`
      );
      throw new ForbiddenException(
        `Node ${callerNodeId} cannot ${operation} job ${jobId} - job is assigned to node ${job.nodeId}`
      );
    }

    return { nodeId: job.nodeId, updatedAt: job.updatedAt };
  }

  /**
   * Validate file path to prevent directory traversal attacks
   */
  validateFilePath(filePath: string, libraryPath: string): void {
    const path = require('node:path');
    const fs = require('node:fs');

    if (
      filePath.includes('..') ||
      filePath.includes('%2e') ||
      filePath.includes('%2E') ||
      filePath.includes('․')
    ) {
      throw new BadRequestException('File path contains directory traversal attempt');
    }

    const resolvedFile = path.resolve(filePath);
    const resolvedLibrary = path.resolve(libraryPath);

    try {
      const O_NOFOLLOW = 0o400000;
      const fd = fs.openSync(resolvedFile, fs.constants.O_RDONLY | O_NOFOLLOW);

      let realFile: string;
      try {
        realFile = fs.readlinkSync(`/proc/self/fd/${fd}`);
      } catch {
        realFile = resolvedFile;
      }

      fs.closeSync(fd);
      const realLibrary = fs.realpathSync(resolvedLibrary);

      if (!realFile.startsWith(realLibrary + path.sep)) {
        throw new BadRequestException(`File path '${filePath}' is outside library boundary`);
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ELOOP') {
        throw new BadRequestException('Symlink detected - operation rejected for security');
      }

      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        let currentPath = path.dirname(resolvedFile);
        let depth = 0;
        const maxDepth = 20;

        while (depth < maxDepth) {
          try {
            const realParent = fs.realpathSync(currentPath);
            const realLibrary = fs.realpathSync(resolvedLibrary);

            if (!realParent.startsWith(realLibrary + path.sep)) {
              throw new BadRequestException(`File path '${filePath}' is outside library boundary`);
            }

            return;
          } catch (parentErr: unknown) {
            if (parentErr && typeof parentErr === 'object' && 'code' in parentErr) {
              if (parentErr.code === 'ENOENT') {
                const nextParent = path.dirname(currentPath);
                if (nextParent === currentPath) {
                  throw new BadRequestException(
                    `File path '${filePath}' parent directories do not exist and cannot be validated`
                  );
                }
                currentPath = nextParent;
                depth++;
                continue;
              }
            }
            const message = parentErr instanceof Error ? parentErr.message : 'Unknown error';
            throw new BadRequestException(`Invalid file path: ${message}`);
          }
        }

        throw new BadRequestException(
          `File path '${filePath}' validation failed: too many missing parent directories (depth > ${maxDepth})`
        );
      } else {
        const message = err instanceof Error ? err.message : 'Unknown error';
        throw new BadRequestException(`Path validation error: ${message}`);
      }
    }
  }

  /**
   * Check if a file exists on disk (extracted for testability)
   */
  fileExists(filePath: string): boolean {
    const fs = require('fs') as typeof import('fs');
    return fs.existsSync(filePath);
  }
}
