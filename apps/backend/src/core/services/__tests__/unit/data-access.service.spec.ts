import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { PrismaService } from '../../../../prisma/prisma.service';
import { DataAccessService } from '../../data-access.service';
import { NodeConfigService } from '../../node-config.service';

describe('DataAccessService', () => {
  let service: DataAccessService;

  const mockPrismaService = {};

  const mockHttpService = {
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
  };

  const mockNodeConfigService = {
    getRole: jest.fn(),
    getMainApiUrl: jest.fn(),
    isLinkedNode: jest.fn(),
    isMainNode: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataAccessService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: NodeConfigService, useValue: mockNodeConfigService },
      ],
    }).compile();

    service = module.get<DataAccessService>(DataAccessService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getNextJob', () => {
    it('should throw on MAIN node', async () => {
      mockNodeConfigService.getRole.mockReturnValue('MAIN');

      await expect(service.getNextJob('node-1')).rejects.toThrow(
        'getNextJob should not be called directly on MAIN nodes'
      );
    });

    it('should call MAIN API on LINKED node and return job', async () => {
      mockNodeConfigService.getRole.mockReturnValue('LINKED');
      mockNodeConfigService.getMainApiUrl.mockReturnValue('http://main:3000');

      const mockJob = { id: 'job-1', fileLabel: 'test.mkv' };
      mockHttpService.get.mockReturnValue(of({ data: mockJob }));

      const result = await service.getNextJob('node-1');

      expect(result).toEqual(mockJob);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://main:3000/api/v1/queue/next-job',
        expect.objectContaining({ params: { nodeId: 'node-1' }, timeout: 10000 })
      );
    });

    it('should return null when no jobs available', async () => {
      mockNodeConfigService.getRole.mockReturnValue('LINKED');
      mockNodeConfigService.getMainApiUrl.mockReturnValue('http://main:3000');
      mockHttpService.get.mockReturnValue(of({ data: null }));

      const result = await service.getNextJob('node-1');

      expect(result).toBeNull();
    });

    it('should propagate errors from MAIN API', async () => {
      mockNodeConfigService.getRole.mockReturnValue('LINKED');
      mockNodeConfigService.getMainApiUrl.mockReturnValue('http://main:3000');
      mockHttpService.get.mockReturnValue(throwError(() => new Error('Network error')));

      await expect(service.getNextJob('node-1')).rejects.toThrow('Network error');
    });
  });

  describe('updateJobProgress', () => {
    it('should throw on MAIN node', async () => {
      mockNodeConfigService.getRole.mockReturnValue('MAIN');

      await expect(service.updateJobProgress('job-1', 50, 120)).rejects.toThrow(
        'updateJobProgress should not be called directly on MAIN nodes'
      );
    });

    it('should call MAIN API on LINKED node', async () => {
      mockNodeConfigService.getRole.mockReturnValue('LINKED');
      mockNodeConfigService.getMainApiUrl.mockReturnValue('http://main:3000');
      mockHttpService.patch.mockReturnValue(of({ data: {} }));

      await service.updateJobProgress('job-1', 75.5, 60);

      expect(mockHttpService.patch).toHaveBeenCalledWith(
        'http://main:3000/api/v1/queue/job-1/progress',
        { progress: 75.5, etaSeconds: 60 },
        { timeout: 5000 }
      );
    });

    it('should not throw on API error (non-critical)', async () => {
      mockNodeConfigService.getRole.mockReturnValue('LINKED');
      mockNodeConfigService.getMainApiUrl.mockReturnValue('http://main:3000');
      mockHttpService.patch.mockReturnValue(throwError(() => new Error('timeout')));

      await expect(service.updateJobProgress('job-1', 50, 60)).resolves.not.toThrow();
    });
  });

  describe('updateJobStage', () => {
    it('should throw on MAIN node', async () => {
      mockNodeConfigService.getRole.mockReturnValue('MAIN');

      await expect(service.updateJobStage('job-1', 'ENCODING' as any)).rejects.toThrow(
        'updateJobStage should not be called directly on MAIN nodes'
      );
    });

    it('should call MAIN API with stage and data on LINKED node', async () => {
      mockNodeConfigService.getRole.mockReturnValue('LINKED');
      mockNodeConfigService.getMainApiUrl.mockReturnValue('http://main:3000');
      mockHttpService.patch.mockReturnValue(of({ data: {} }));

      await service.updateJobStage('job-1', 'COMPLETED' as any, { outputSize: 1024 });

      expect(mockHttpService.patch).toHaveBeenCalledWith(
        'http://main:3000/api/v1/queue/job-1/stage',
        { stage: 'COMPLETED', outputSize: 1024 },
        { timeout: 5000 }
      );
    });

    it('should propagate errors from MAIN API', async () => {
      mockNodeConfigService.getRole.mockReturnValue('LINKED');
      mockNodeConfigService.getMainApiUrl.mockReturnValue('http://main:3000');
      mockHttpService.patch.mockReturnValue(throwError(() => new Error('Server error')));

      await expect(service.updateJobStage('job-1', 'ENCODING' as any)).rejects.toThrow(
        'Server error'
      );
    });
  });

  describe('sendHeartbeat', () => {
    it('should throw on MAIN node', async () => {
      mockNodeConfigService.getRole.mockReturnValue('MAIN');

      await expect(service.sendHeartbeat('node-1')).rejects.toThrow(
        'sendHeartbeat should not be called directly on MAIN nodes'
      );
    });

    it('should not throw on API error (non-critical)', async () => {
      mockNodeConfigService.getRole.mockReturnValue('LINKED');
      mockNodeConfigService.getMainApiUrl.mockReturnValue('http://main:3000');
      mockHttpService.post.mockReturnValue(throwError(() => new Error('timeout')));

      await expect(service.sendHeartbeat('node-1')).resolves.not.toThrow();
    });
  });

  describe('getNode', () => {
    it('should throw on MAIN node', async () => {
      mockNodeConfigService.getRole.mockReturnValue('MAIN');

      await expect(service.getNode('node-1')).rejects.toThrow(
        'getNode should not be called directly on MAIN nodes'
      );
    });

    it('should return node from MAIN API on LINKED node', async () => {
      mockNodeConfigService.getRole.mockReturnValue('LINKED');
      mockNodeConfigService.getMainApiUrl.mockReturnValue('http://main:3000');

      const mockNode = { id: 'node-1', name: 'Worker 1' };
      mockHttpService.get.mockReturnValue(of({ data: mockNode }));

      const result = await service.getNode('node-1');

      expect(result).toEqual(mockNode);
    });
  });

  describe('mode helpers', () => {
    it('isLinkedMode should delegate to nodeConfig', () => {
      mockNodeConfigService.isLinkedNode.mockReturnValue(true);
      expect(service.isLinkedMode()).toBe(true);
    });

    it('isMainMode should delegate to nodeConfig', () => {
      mockNodeConfigService.isMainNode.mockReturnValue(true);
      expect(service.isMainMode()).toBe(true);
    });

    it('getNodeRole should delegate to nodeConfig', () => {
      mockNodeConfigService.getRole.mockReturnValue('LINKED');
      expect(service.getNodeRole()).toBe('LINKED');
    });

    it('getMainApiUrl should delegate to nodeConfig', () => {
      mockNodeConfigService.getMainApiUrl.mockReturnValue('http://main:3000');
      expect(service.getMainApiUrl()).toBe('http://main:3000');
    });
  });
});
