import { Injectable } from '@nestjs/common';
import { type Library } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from './base.repository';

interface LibraryAggregateResult {
  _sum: { sizeBytes: bigint | null };
}

@Injectable()
export class LibraryRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma, 'library');
  }

  async findById(id: string): Promise<Library | null> {
    return this.findUnique<Library | null>({ where: { id } });
  }

  async findByNodeId(nodeId: string): Promise<Library[]> {
    return this.findMany<Library>({ where: { nodeId } });
  }

  async findActive(): Promise<Library[]> {
    return this.findMany<Library>({
      where: { isActive: true },
    });
  }

  async findByPath(filePath: string): Promise<Library | null> {
    return this.findFirst<Library | null>({
      where: { path: filePath },
    });
  }

  async countActive(): Promise<number> {
    return this.count({
      where: { isActive: true },
    });
  }

  async updateLastScan(id: string): Promise<Library> {
    return this.update<Library>({
      where: { id },
      data: { lastScanAt: new Date() },
    });
  }

  async getTotalSize(): Promise<bigint> {
    const result = await this.aggregate<LibraryAggregateResult>({
      _sum: { sizeBytes: true },
      where: { isActive: true },
    });
    return result._sum.sizeBytes ?? BigInt(0);
  }
}
