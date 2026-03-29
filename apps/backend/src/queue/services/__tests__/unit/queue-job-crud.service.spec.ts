import { HttpService } from '@nestjs/axios';
import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { ContentFingerprintService } from '../../../../core/services/content-fingerprint.service';
import { NodeConfigService } from '../../../../core/services/node-config.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { FileFailureTrackingService } from '../../file-failure-tracking.service';
import { QueueJobCrudService } from '../../queue-job-crud.service';

describe('QueueJobCrudService', () => {
  let service: QueueJobCrudService;

  beforeEach(async () => {
    const prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueJobCrudService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NodeConfigService,
          useValue: {
            getMainApiUrl: jest.fn().mockReturnValue(null),
            getNodeId: jest.fn().mockReturnValue('node-1'),
          },
        },
        { provide: HttpService, useValue: { post: jest.fn() } },
        { provide: ContentFingerprintService, useValue: { generateFingerprint: jest.fn() } },
        {
          provide: FileFailureTrackingService,
          useValue: { recordFailure: jest.fn(), clearBlacklist: jest.fn() },
        },
      ],
    }).compile();
    service = module.get<QueueJobCrudService>(QueueJobCrudService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
