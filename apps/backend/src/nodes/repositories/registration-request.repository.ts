import { Injectable } from '@nestjs/common';
import {
  type NodeRegistrationRequest,
  type Prisma,
  type RegistrationRequestStatus,
} from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RegistrationRequestRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma, 'nodeRegistrationRequest');
  }

  async findFirstByMac(
    mainNodeId: string,
    macAddress: string,
    status: RegistrationRequestStatus
  ): Promise<NodeRegistrationRequest | null> {
    return this.findFirst<NodeRegistrationRequest | null>({
      where: { mainNodeId, macAddress, status },
    });
  }

  async createRequest(data: Record<string, unknown>): Promise<NodeRegistrationRequest> {
    return this.create<NodeRegistrationRequest>({ data });
  }

  async updateById(id: string, data: Record<string, unknown>): Promise<NodeRegistrationRequest> {
    return this.update<NodeRegistrationRequest>({ where: { id }, data });
  }

  async updateByPairingToken(
    pairingToken: string,
    data: Record<string, unknown>
  ): Promise<NodeRegistrationRequest> {
    return this.update<NodeRegistrationRequest>({ where: { pairingToken }, data });
  }

  async findManyPending(mainNodeId: string): Promise<NodeRegistrationRequest[]> {
    return this.findMany<NodeRegistrationRequest>({
      where: {
        mainNodeId,
        status: 'PENDING' as RegistrationRequestStatus,
        tokenExpiresAt: { gt: new Date() },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async findUniqueById(
    id: string
  ): Promise<(NodeRegistrationRequest & { mainNode: unknown }) | null> {
    return this.findUnique<(NodeRegistrationRequest & { mainNode: unknown }) | null>({
      where: { id },
      include: { mainNode: true },
    });
  }

  async findUniqueByToken(
    pairingToken: string
  ): Promise<(NodeRegistrationRequest & { mainNode: unknown }) | null> {
    return this.findUnique<(NodeRegistrationRequest & { mainNode: unknown }) | null>({
      where: { pairingToken },
      include: { mainNode: true },
    });
  }

  async updateManyExpired(now: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.nodeRegistrationRequest.updateMany({
      where: {
        status: 'PENDING' as RegistrationRequestStatus,
        tokenExpiresAt: { lt: now },
      },
      data: { status: 'EXPIRED' as RegistrationRequestStatus },
    });
  }

  async deleteManyOld(
    before: Date,
    statuses: RegistrationRequestStatus[]
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.nodeRegistrationRequest.deleteMany({
      where: {
        createdAt: { lt: before },
        status: { in: statuses },
      },
    });
  }

  async approveTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
