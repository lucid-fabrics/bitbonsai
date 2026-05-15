import { Injectable } from '@nestjs/common';
import { type FileFailureRecord } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from './base.repository';

@Injectable()
export class FileFailureRecordRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma, 'fileFailureRecord');
  }

  async isBlacklisted(
    filePath: string,
    libraryId: string,
    contentFingerprint?: string
  ): Promise<boolean> {
    const orConditions: Record<string, unknown>[] = [{ filePath, libraryId }];

    if (contentFingerprint) {
      orConditions.push({ contentFingerprint });
    }

    const match = await this.findFirst<Pick<FileFailureRecord, 'id'> | null>({
      where: {
        autoBlacklisted: true,
        OR: orConditions,
      },
      select: { id: true },
    });

    return !!match;
  }

  async getBlacklistedPaths(filePaths: string[], libraryId: string): Promise<Set<string>> {
    if (filePaths.length === 0) return new Set();

    const records = await this.findMany<Pick<FileFailureRecord, 'filePath'>>({
      where: {
        libraryId,
        autoBlacklisted: true,
        filePath: { in: filePaths },
      },
      select: { filePath: true },
    });

    return new Set(records.map((r) => r.filePath));
  }

  async clearBlacklist(filePath: string, libraryId: string): Promise<void> {
    await this.prisma.fileFailureRecord.updateMany({
      where: { filePath, libraryId },
      data: { totalFailures: 0, autoBlacklisted: false },
    });
  }

  async getFailureCount(filePath: string, libraryId: string): Promise<number> {
    const record = await this.findUnique<Pick<FileFailureRecord, 'totalFailures'> | null>({
      where: { filePath_libraryId: { filePath, libraryId } },
      select: { totalFailures: true },
    });

    return record?.totalFailures ?? 0;
  }
}
