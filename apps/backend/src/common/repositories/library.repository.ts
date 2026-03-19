import { Injectable } from '@nestjs/common';
import { type Library, type Prisma } from '@prisma/client';
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

  async aggregateTotalSizeBytes(): Promise<{ _sum: { totalSizeBytes: bigint | null } }> {
    return this.prisma.library.aggregate({ _sum: { totalSizeBytes: true } }) as Promise<{
      _sum: { totalSizeBytes: bigint | null };
    }>;
  }

  async findManyWithJobCountOrdered(
    take: number
  ): Promise<Array<Library & { _count: { jobs: number } }>> {
    return this.prisma.library.findMany({
      include: { _count: { select: { jobs: true } } },
      orderBy: { jobs: { _count: 'desc' } },
      take,
    }) as Promise<Array<Library & { _count: { jobs: number } }>>;
  }

  async findByWhere(where: Prisma.LibraryWhereUniqueInput): Promise<Library | null> {
    return this.prisma.library.findUnique({ where });
  }

  async findUniqueWithInclude(
    where: Prisma.LibraryWhereUniqueInput,
    include: Prisma.LibraryInclude
  ): Promise<(Library & Record<string, unknown>) | null> {
    return this.prisma.library.findUnique({ where, include }) as Promise<
      (Library & Record<string, unknown>) | null
    >;
  }

  async findFirstWhere(where: Prisma.LibraryWhereInput): Promise<Library | null> {
    return this.prisma.library.findFirst({ where });
  }

  async findAllLibraries(
    where?: Prisma.LibraryWhereInput,
    include?: Prisma.LibraryInclude
  ): Promise<Library[]> {
    return this.prisma.library.findMany({ ...(where && { where }), ...(include && { include }) });
  }

  async createLibrary(data: Prisma.LibraryUncheckedCreateInput): Promise<Library> {
    return this.prisma.library.create({ data });
  }

  async updateLibrary(
    where: Prisma.LibraryWhereUniqueInput,
    data: Prisma.LibraryUncheckedUpdateInput
  ): Promise<Library> {
    return this.prisma.library.update({ where, data });
  }

  async updateWithInclude(
    where: Prisma.LibraryWhereUniqueInput,
    data: Prisma.LibraryUncheckedUpdateInput,
    include: Prisma.LibraryInclude
  ): Promise<Library & Record<string, unknown>> {
    return this.prisma.library.update({ where, data, include }) as Promise<
      Library & Record<string, unknown>
    >;
  }

  async deleteLibrary(where: Prisma.LibraryWhereUniqueInput): Promise<Library> {
    return this.prisma.library.delete({ where });
  }

  async upsertLibrary(
    where: Prisma.LibraryWhereUniqueInput,
    create: Prisma.LibraryUncheckedCreateInput,
    update: Prisma.LibraryUncheckedUpdateInput
  ): Promise<Library> {
    return this.prisma.library.upsert({ where, create, update });
  }
}
