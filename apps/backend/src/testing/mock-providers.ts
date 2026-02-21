/**
 * Shared Mock Providers for Backend Tests
 *
 * Provides pre-configured mock providers for common NestJS dependencies.
 * Use these in Test.createTestingModule({ providers: [...mockProviders] })
 * to avoid "Nest can't resolve dependencies" errors.
 *
 * Usage:
 *   import { mockPrismaProvider, mockNodeConfigProvider } from '../../../testing/mock-providers';
 *   const module = await Test.createTestingModule({
 *     providers: [MyService, mockPrismaProvider, mockNodeConfigProvider],
 *   }).compile();
 */
import { HttpService } from '@nestjs/axios';
import type { Provider } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataAccessService } from '../core/services/data-access.service';
import { FileRelocatorService } from '../core/services/file-relocator.service';
import { NodeConfigService } from '../core/services/node-config.service';
import { DistributionOrchestratorService } from '../distribution/services/distribution-orchestrator.service';
import { EncodingPreviewService } from '../encoding/encoding-preview.service';
import { FfmpegService } from '../encoding/ffmpeg.service';
import { FileWatcherService } from '../file-watcher/file-watcher.service';
import { JellyfinIntegrationService } from '../integrations/jellyfin.service';
import { LibrariesService } from '../libraries/libraries.service';
import { MediaAnalysisService } from '../libraries/services/media-analysis.service';
import { NodesService } from '../nodes/nodes.service';
import { SharedStorageVerifierService } from '../nodes/services/shared-storage-verifier.service';
import { StorageShareService } from '../nodes/services/storage-share.service';
import { SystemInfoService } from '../nodes/services/system-info.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { FileTransferService } from '../queue/services/file-transfer.service';
import { JobHistoryService } from '../queue/services/job-history.service';
import { JobRouterService } from '../queue/services/job-router.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Creates a comprehensive PrismaService mock with all models and common methods.
 */
export function createMockPrismaService() {
  return {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    $transaction: jest.fn().mockImplementation((fnOrPromises: unknown) => {
      if (typeof fnOrPromises === 'function') {
        return (fnOrPromises as (prisma: ReturnType<typeof createMockPrismaService>) => unknown)(
          createMockPrismaService()
        );
      }
      return Promise.all(fnOrPromises as Promise<unknown>[]);
    }),
    job: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    node: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    library: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    policy: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(),
    },
    license: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    metric: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    settings: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    jobHistory: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    nodeRegistrationRequest: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    storageShare: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    metricsProcessedJob: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    nodeFailureLog: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn(),
    },
    distributionConfig: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

export const mockPrismaProvider: Provider = {
  provide: PrismaService,
  useFactory: createMockPrismaService,
};

export const mockEventEmitterProvider: Provider = {
  provide: EventEmitter2,
  useValue: {
    emit: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn(),
  },
};

export const mockNodeConfigProvider: Provider = {
  provide: NodeConfigService,
  useValue: {
    getConfig: jest.fn(),
    getRole: jest.fn().mockReturnValue('MAIN'),
    getNodeId: jest.fn().mockReturnValue('node-1'),
    isMainNode: jest.fn().mockReturnValue(true),
    getMainApiUrl: jest.fn().mockReturnValue(null),
  },
};

export const mockDataAccessProvider: Provider = {
  provide: DataAccessService,
  useValue: {
    getJobs: jest.fn().mockResolvedValue([]),
    getJob: jest.fn(),
    updateJob: jest.fn(),
    createJob: jest.fn(),
    deleteJob: jest.fn(),
    getNodes: jest.fn().mockResolvedValue([]),
    getNode: jest.fn(),
  },
};

export const mockHttpServiceProvider: Provider = {
  provide: HttpService,
  useValue: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    axiosRef: { defaults: {} },
  },
};

export const mockNodesServiceProvider: Provider = {
  provide: NodesService,
  useValue: {
    findOne: jest.fn(),
    findAll: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    getNodeId: jest.fn().mockReturnValue('node-1'),
  },
};

export const mockLibrariesServiceProvider: Provider = {
  provide: LibrariesService,
  useValue: {
    findOne: jest.fn(),
    findAll: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    scan: jest.fn(),
  },
};

export const mockQueueServiceProvider: Provider = {
  provide: QueueService,
  useValue: {
    getNextJob: jest.fn(),
    completeJob: jest.fn(),
    failJob: jest.fn(),
    updateProgress: jest.fn(),
    update: jest.fn(),
    getQueueStats: jest.fn(),
    addJob: jest.fn(),
    cancelJob: jest.fn(),
    pauseJob: jest.fn(),
    resumeJob: jest.fn(),
  },
};

export const mockFfmpegServiceProvider: Provider = {
  provide: FfmpegService,
  useValue: {
    encode: jest.fn(),
    encodeFile: jest.fn(),
    verifyFile: jest.fn(),
    detectHardwareAcceleration: jest.fn(),
    buildFfmpegCommand: jest.fn(),
    cancelEncoding: jest.fn(),
    getActiveEncodings: jest.fn().mockReturnValue([]),
    getEncodingStatus: jest.fn(),
  },
};

export const mockFileRelocatorProvider: Provider = {
  provide: FileRelocatorService,
  useValue: {
    relocateFile: jest.fn(),
    findFiles: jest.fn().mockResolvedValue([]),
  },
};

export const mockJobHistoryProvider: Provider = {
  provide: JobHistoryService,
  useValue: {
    recordHistory: jest.fn(),
    recordEvent: jest.fn(),
    getHistory: jest.fn().mockResolvedValue([]),
  },
};

export const mockJobRouterProvider: Provider = {
  provide: JobRouterService,
  useValue: {
    findOptimalNode: jest.fn(),
    routeJob: jest.fn(),
  },
};

export const mockFileTransferProvider: Provider = {
  provide: FileTransferService,
  useValue: {
    transferFile: jest.fn(),
    verifyTransfer: jest.fn(),
  },
};

export const mockMediaAnalysisProvider: Provider = {
  provide: MediaAnalysisService,
  useValue: {
    analyze: jest.fn(),
    getMediaInfo: jest.fn(),
    getVideoCodecInfo: jest.fn(),
  },
};

export const mockSharedStorageVerifierProvider: Provider = {
  provide: SharedStorageVerifierService,
  useValue: {
    verify: jest.fn(),
    isSharedStorage: jest.fn(),
  },
};

export const mockSystemInfoProvider: Provider = {
  provide: SystemInfoService,
  useValue: {
    getSystemInfo: jest.fn(),
    collectSystemInfo: jest.fn().mockResolvedValue({ ipAddress: '127.0.0.1' }),
  },
};

export const mockStorageShareProvider: Provider = {
  provide: StorageShareService,
  useValue: {
    getSharedPaths: jest.fn(),
    isSharedStorage: jest.fn(),
    findAll: jest.fn().mockResolvedValue([]),
  },
};

export const mockFileWatcherProvider: Provider = {
  provide: FileWatcherService,
  useValue: {
    startWatcher: jest.fn(),
    stopWatcher: jest.fn(),
  },
};

export const mockSettingsProvider: Provider = {
  provide: SettingsService,
  useValue: {
    get: jest.fn(),
    set: jest.fn(),
    getAll: jest.fn(),
    getSettings: jest.fn(),
  },
};

export const mockDistributionOrchestratorProvider: Provider = {
  provide: DistributionOrchestratorService,
  useValue: {
    distribute: jest.fn(),
    rebalance: jest.fn(),
  },
};

export const mockEncodingPreviewProvider: Provider = {
  provide: EncodingPreviewService,
  useValue: {
    generatePreview: jest.fn(),
    cleanupPreviews: jest.fn(),
  },
};

export const mockJellyfinProvider: Provider = {
  provide: JellyfinIntegrationService,
  useValue: {
    notifyLibraryScan: jest.fn(),
    refreshLibrary: jest.fn(),
  },
};
