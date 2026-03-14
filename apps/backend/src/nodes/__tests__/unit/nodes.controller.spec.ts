import { Test, type TestingModule } from '@nestjs/testing';
import { NodesController } from '../../nodes.controller';
import { NodesService } from '../../nodes.service';
import { JobAttributionService } from '../../services/job-attribution.service';
import { NodeCapabilityDetectorService } from '../../services/node-capability-detector.service';
import { NodeDiscoveryService } from '../../services/node-discovery.service';
import { RegistrationRequestService } from '../../services/registration-request.service';
import { SshKeyService } from '../../services/ssh-key.service';

describe('NodesController', () => {
  let controller: NodesController;

  const mockNodesService = {
    registerNode: jest.fn(),
    pairNode: jest.fn(),
    generatePairingTokenForNode: jest.fn(),
    heartbeat: jest.fn(),
    getCurrentNode: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    getNodeStats: jest.fn(),
    getRecommendedConfig: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    unregisterSelf: jest.fn(),
  };

  const mockNodeDiscoveryService = {
    discoverMainNodes: jest.fn(),
  };

  const mockRegistrationRequestService = {
    createRegistrationRequest: jest.fn(),
    getPendingRequests: jest.fn(),
    getRequest: jest.fn(),
    approveRequest: jest.fn(),
    rejectRequest: jest.fn(),
    cancelRequest: jest.fn(),
    cancelRequestByToken: jest.fn(),
  };

  const mockCapabilityDetector = {
    detectCapabilities: jest.fn(),
  };

  const mockJobAttribution = {
    getAllNodeScores: jest.fn(),
    clearCache: jest.fn(),
  };

  const mockSshKeyService = {
    getPublicKey: jest.fn(),
    addAuthorizedKey: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NodesController],
      providers: [
        { provide: NodesService, useValue: mockNodesService },
        { provide: NodeDiscoveryService, useValue: mockNodeDiscoveryService },
        { provide: RegistrationRequestService, useValue: mockRegistrationRequestService },
        { provide: NodeCapabilityDetectorService, useValue: mockCapabilityDetector },
        { provide: JobAttributionService, useValue: mockJobAttribution },
        { provide: SshKeyService, useValue: mockSshKeyService },
      ],
    }).compile();

    controller = module.get<NodesController>(NodesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should register a node and return registration response', async () => {
      const dto = { licenseKey: 'abc-123', name: 'Main Node' };
      const response = { id: 'node1', apiKey: 'key-xyz', pairingToken: '123456' };
      mockNodesService.registerNode.mockResolvedValue(response);

      const result = await controller.register(dto as any);

      expect(mockNodesService.registerNode).toHaveBeenCalledWith(dto);
      expect(result).toEqual(response);
    });

    it('should propagate license validation errors', async () => {
      mockNodesService.registerNode.mockRejectedValue(new Error('invalid license'));
      await expect(controller.register({} as any)).rejects.toThrow('invalid license');
    });
  });

  describe('pair', () => {
    it('should pair a node using pairing token', async () => {
      const dto = { pairingToken: '123456' };
      const node = { id: 'node1', name: 'Main', role: 'MAIN', status: 'ONLINE' };
      mockNodesService.pairNode.mockResolvedValue(node);

      const result = await controller.pair(dto as any);

      expect(mockNodesService.pairNode).toHaveBeenCalledWith('123456');
      expect(result).toBeDefined();
    });

    it('should propagate invalid token errors', async () => {
      mockNodesService.pairNode.mockRejectedValue(new Error('invalid token'));
      await expect(controller.pair({ pairingToken: 'bad' } as any)).rejects.toThrow(
        'invalid token'
      );
    });
  });

  describe('generatePairingToken', () => {
    it('should generate a new pairing token for a node', async () => {
      const response = { id: 'node1', pairingToken: '654321', pairingExpiresAt: new Date() };
      mockNodesService.generatePairingTokenForNode.mockResolvedValue(response);

      const result = await controller.generatePairingToken('node1');

      expect(mockNodesService.generatePairingTokenForNode).toHaveBeenCalledWith('node1');
      expect(result).toEqual(response);
    });

    it('should propagate errors when node already paired', async () => {
      mockNodesService.generatePairingTokenForNode.mockRejectedValue(new Error('already paired'));
      await expect(controller.generatePairingToken('node1')).rejects.toThrow('already paired');
    });
  });

  describe('heartbeat', () => {
    it('should record heartbeat and return node dto', async () => {
      const heartbeatDto = { cpuUsage: 42, memoryUsage: 60 };
      const node = { id: 'node1', status: 'ONLINE', lastHeartbeat: new Date() };
      mockNodesService.heartbeat.mockResolvedValue(node);

      const result = await controller.heartbeat('node1', heartbeatDto as any);

      expect(mockNodesService.heartbeat).toHaveBeenCalledWith('node1', heartbeatDto);
      expect(result).toBeDefined();
    });

    it('should propagate errors for unknown node', async () => {
      mockNodesService.heartbeat.mockRejectedValue(new Error('node not found'));
      await expect(controller.heartbeat('missing', undefined)).rejects.toThrow('node not found');
    });
  });

  describe('getCurrentNode', () => {
    it('should return current node info', async () => {
      const node = { id: 'node1', role: 'MAIN', version: '1.0.0' };
      mockNodesService.getCurrentNode.mockResolvedValue(node);

      const result = await controller.getCurrentNode();

      expect(mockNodesService.getCurrentNode).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    it('should propagate errors when no nodes registered', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('no nodes found'));
      await expect(controller.getCurrentNode()).rejects.toThrow('no nodes found');
    });
  });

  describe('findAll', () => {
    it('should return all nodes as response dtos', async () => {
      const nodes = [
        { id: 'node1', name: 'Main', role: 'MAIN' },
        { id: 'node2', name: 'Worker', role: 'LINKED' },
      ];
      mockNodesService.findAll.mockResolvedValue(nodes);

      const result = await controller.findAll();

      expect(mockNodesService.findAll).toHaveBeenCalledTimes(1);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should propagate service errors', async () => {
      mockNodesService.findAll.mockRejectedValue(new Error('db error'));
      await expect(controller.findAll()).rejects.toThrow('db error');
    });
  });

  describe('getNodeScores', () => {
    it('should return node scores from job attribution service', async () => {
      const scores = [{ nodeId: 'node1', nodeName: 'Main', totalScore: 85 }];
      mockJobAttribution.getAllNodeScores.mockResolvedValue(scores);

      const result = await controller.getNodeScores();

      expect(mockJobAttribution.getAllNodeScores).toHaveBeenCalledTimes(1);
      expect(result).toEqual(scores);
    });

    it('should propagate service errors', async () => {
      mockJobAttribution.getAllNodeScores.mockRejectedValue(new Error('score calc failed'));
      await expect(controller.getNodeScores()).rejects.toThrow('score calc failed');
    });
  });

  describe('findOne', () => {
    it('should return a single node as response dto', async () => {
      const node = { id: 'node1', name: 'Main', role: 'MAIN', status: 'ONLINE' };
      mockNodesService.findOne.mockResolvedValue(node);

      const result = await controller.findOne('node1');

      expect(mockNodesService.findOne).toHaveBeenCalledWith('node1');
      expect(result).toBeDefined();
    });

    it('should propagate not found errors', async () => {
      mockNodesService.findOne.mockRejectedValue(new Error('not found'));
      await expect(controller.findOne('missing')).rejects.toThrow('not found');
    });
  });

  describe('getStats', () => {
    it('should return node statistics', async () => {
      const stats = { activeJobs: 2, uptimeSeconds: 86400, libraries: [] };
      mockNodesService.getNodeStats.mockResolvedValue(stats);

      const result = await controller.getStats('node1');

      expect(mockNodesService.getNodeStats).toHaveBeenCalledWith('node1');
      expect(result).toEqual(stats);
    });

    it('should propagate service errors', async () => {
      mockNodesService.getNodeStats.mockRejectedValue(new Error('stats error'));
      await expect(controller.getStats('node1')).rejects.toThrow('stats error');
    });
  });

  describe('getRecommendedConfig', () => {
    it('should return recommended configuration', async () => {
      const config = { maxWorkers: 4, reasoning: 'CPU: 8 cores, GPU: none' };
      mockNodesService.getRecommendedConfig.mockResolvedValue(config);

      const result = await controller.getRecommendedConfig('node1');

      expect(mockNodesService.getRecommendedConfig).toHaveBeenCalledWith('node1');
      expect(result).toEqual(config);
    });

    it('should propagate service errors', async () => {
      mockNodesService.getRecommendedConfig.mockRejectedValue(new Error('node not found'));
      await expect(controller.getRecommendedConfig('node1')).rejects.toThrow('node not found');
    });
  });

  describe('update', () => {
    it('should update node and return response dto', async () => {
      const dto = { maxWorkers: 6, name: 'Renamed Node' };
      const node = { id: 'node1', ...dto };
      mockNodesService.update.mockResolvedValue(node);

      const result = await controller.update('node1', dto as any);

      expect(mockNodesService.update).toHaveBeenCalledWith('node1', dto);
      expect(result).toBeDefined();
    });

    it('should propagate service errors', async () => {
      mockNodesService.update.mockRejectedValue(new Error('invalid update'));
      await expect(controller.update('node1', {} as any)).rejects.toThrow('invalid update');
    });
  });

  describe('remove', () => {
    it('should remove a node', async () => {
      mockNodesService.remove.mockResolvedValue(undefined);

      await controller.remove('node1');

      expect(mockNodesService.remove).toHaveBeenCalledWith('node1');
    });

    it('should propagate errors for unknown node', async () => {
      mockNodesService.remove.mockRejectedValue(new Error('not found'));
      await expect(controller.remove('missing')).rejects.toThrow('not found');
    });
  });

  describe('unregisterSelf', () => {
    it('should unregister current node', async () => {
      const response = { success: true, message: 'Successfully unregistered from main node' };
      mockNodesService.unregisterSelf.mockResolvedValue(response);

      const result = await controller.unregisterSelf();

      expect(mockNodesService.unregisterSelf).toHaveBeenCalledTimes(1);
      expect(result).toEqual(response);
    });

    it('should propagate errors for MAIN node trying to unregister', async () => {
      mockNodesService.unregisterSelf.mockRejectedValue(new Error('MAIN node cannot unregister'));
      await expect(controller.unregisterSelf()).rejects.toThrow('MAIN node cannot unregister');
    });
  });

  describe('discoverMainNodes', () => {
    it('should return discovered main nodes from discovery service', async () => {
      const nodes = [{ id: 'main1', name: 'Main Node', ip: '192.168.1.100' }];
      mockNodeDiscoveryService.discoverMainNodes.mockResolvedValue(nodes);

      const result = await controller.discoverMainNodes();

      expect(mockNodeDiscoveryService.discoverMainNodes).toHaveBeenCalledTimes(1);
      expect(result).toEqual(nodes);
    });

    it('should propagate discovery errors', async () => {
      mockNodeDiscoveryService.discoverMainNodes.mockRejectedValue(new Error('mdns error'));
      await expect(controller.discoverMainNodes()).rejects.toThrow('mdns error');
    });
  });

  describe('createRegistrationRequest', () => {
    it('should create a registration request and return response dto', async () => {
      const dto = { hostname: 'worker1', ipAddress: '192.168.1.50', macAddress: 'aa:bb:cc:dd' };
      const request = { id: 'req1', pairingToken: '111222', status: 'PENDING' };
      mockRegistrationRequestService.createRegistrationRequest.mockResolvedValue(request);

      const result = await controller.createRegistrationRequest(dto as any);

      expect(mockRegistrationRequestService.createRegistrationRequest).toHaveBeenCalledWith(dto);
      expect(result).toBeDefined();
    });

    it('should propagate service errors', async () => {
      mockRegistrationRequestService.createRegistrationRequest.mockRejectedValue(
        new Error('invalid data')
      );
      await expect(controller.createRegistrationRequest({} as any)).rejects.toThrow('invalid data');
    });
  });

  describe('getPendingRequests', () => {
    it('should return pending registration requests for current main node', async () => {
      const currentNode = { id: 'main1', role: 'MAIN' };
      const requests = [
        { id: 'req1', status: 'PENDING' },
        { id: 'req2', status: 'PENDING' },
      ];
      mockNodesService.getCurrentNode.mockResolvedValue(currentNode);
      mockRegistrationRequestService.getPendingRequests.mockResolvedValue(requests);

      const result = await controller.getPendingRequests();

      expect(mockNodesService.getCurrentNode).toHaveBeenCalledTimes(1);
      expect(mockRegistrationRequestService.getPendingRequests).toHaveBeenCalledWith('main1');
      expect(Array.isArray(result)).toBe(true);
    });

    it('should propagate service errors', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('no main node'));
      await expect(controller.getPendingRequests()).rejects.toThrow('no main node');
    });
  });

  describe('getRegistrationRequest', () => {
    it('should return a registration request by id', async () => {
      const request = { id: 'req1', status: 'PENDING', pairingToken: '123456' };
      mockRegistrationRequestService.getRequest.mockResolvedValue(request);

      const result = await controller.getRegistrationRequest('req1');

      expect(mockRegistrationRequestService.getRequest).toHaveBeenCalledWith('req1');
      expect(result).toBeDefined();
    });

    it('should propagate not found errors', async () => {
      mockRegistrationRequestService.getRequest.mockRejectedValue(new Error('not found'));
      await expect(controller.getRegistrationRequest('bad')).rejects.toThrow('not found');
    });
  });

  describe('approveRegistrationRequest', () => {
    it('should approve a registration request', async () => {
      const approveDto = { nodeName: 'Worker 1', maxWorkers: 2 };
      const approved = { id: 'req1', status: 'APPROVED', childNodeId: 'node2' };
      mockRegistrationRequestService.approveRequest.mockResolvedValue(approved);

      const result = await controller.approveRegistrationRequest('req1', approveDto as any);

      expect(mockRegistrationRequestService.approveRequest).toHaveBeenCalledWith(
        'req1',
        approveDto
      );
      expect(result).toBeDefined();
    });

    it('should propagate errors when request is not pending', async () => {
      mockRegistrationRequestService.approveRequest.mockRejectedValue(
        new Error('request not pending')
      );
      await expect(controller.approveRegistrationRequest('req1', undefined)).rejects.toThrow(
        'request not pending'
      );
    });
  });

  describe('rejectRegistrationRequest', () => {
    it('should reject a registration request with reason', async () => {
      const rejectDto = { reason: 'Unauthorized device' };
      const rejected = { id: 'req1', status: 'REJECTED', rejectionReason: 'Unauthorized device' };
      mockRegistrationRequestService.rejectRequest.mockResolvedValue(rejected);

      const result = await controller.rejectRegistrationRequest('req1', rejectDto as any);

      expect(mockRegistrationRequestService.rejectRequest).toHaveBeenCalledWith('req1', rejectDto);
      expect(result).toBeDefined();
    });

    it('should propagate errors for non-pending requests', async () => {
      mockRegistrationRequestService.rejectRequest.mockRejectedValue(new Error('already approved'));
      await expect(controller.rejectRegistrationRequest('req1', {} as any)).rejects.toThrow(
        'already approved'
      );
    });
  });

  describe('cancelRegistrationRequest', () => {
    it('should cancel a registration request by id', async () => {
      const cancelled = { id: 'req1', status: 'CANCELLED' };
      mockRegistrationRequestService.cancelRequest.mockResolvedValue(cancelled);

      const result = await controller.cancelRegistrationRequest('req1');

      expect(mockRegistrationRequestService.cancelRequest).toHaveBeenCalledWith('req1');
      expect(result).toBeDefined();
    });

    it('should propagate errors', async () => {
      mockRegistrationRequestService.cancelRequest.mockRejectedValue(new Error('not pending'));
      await expect(controller.cancelRegistrationRequest('req1')).rejects.toThrow('not pending');
    });
  });

  describe('cancelRegistrationRequestByToken', () => {
    it('should cancel a registration request by token', async () => {
      const cancelled = { id: 'req1', status: 'CANCELLED' };
      mockRegistrationRequestService.cancelRequestByToken.mockResolvedValue(cancelled);

      const result = await controller.cancelRegistrationRequestByToken('123456');

      expect(mockRegistrationRequestService.cancelRequestByToken).toHaveBeenCalledWith('123456');
      expect(result).toBeDefined();
    });

    it('should propagate errors for invalid token', async () => {
      mockRegistrationRequestService.cancelRequestByToken.mockRejectedValue(
        new Error('token not found')
      );
      await expect(controller.cancelRegistrationRequestByToken('bad')).rejects.toThrow(
        'token not found'
      );
    });
  });

  describe('testNodeCapabilities', () => {
    it('should detect capabilities and return test results', async () => {
      const node = {
        id: 'node1',
        name: 'Worker',
        ipAddress: '192.168.1.50',
        cpuCores: 8,
        ramGB: 16,
        publicUrl: null,
        mainNodeUrl: null,
      };
      const capResult = {
        latencyMs: 5,
        isPrivateIP: true,
        hasSharedStorage: true,
        storageBasePath: '/mnt/media',
        networkLocation: 'LOCAL',
      };
      mockNodesService.findOne.mockResolvedValue(node);
      mockCapabilityDetector.detectCapabilities.mockResolvedValue(capResult);

      const result = await controller.testNodeCapabilities('node1');

      expect(mockNodesService.findOne).toHaveBeenCalledWith('node1');
      expect(mockCapabilityDetector.detectCapabilities).toHaveBeenCalledWith(
        'node1',
        '192.168.1.50'
      );
      expect(result).toMatchObject({ nodeId: 'node1', nodeName: 'Worker' });
    });

    it('should propagate service errors', async () => {
      mockNodesService.findOne.mockRejectedValue(new Error('not found'));
      await expect(controller.testNodeCapabilities('missing')).rejects.toThrow('not found');
    });
  });

  describe('getNodeCapabilities', () => {
    it('should return node capability summary', async () => {
      const node = {
        id: 'node1',
        name: 'Worker',
        networkLocation: 'LOCAL',
        hasSharedStorage: true,
        storageBasePath: '/mnt/media',
        latencyMs: 3,
        bandwidthMbps: 950,
        cpuCores: 8,
        ramGB: 32,
        maxTransferSizeMB: 1024,
        lastSpeedTest: new Date(),
      };
      mockNodesService.findOne.mockResolvedValue(node);

      const result = await controller.getNodeCapabilities('node1');

      expect(mockNodesService.findOne).toHaveBeenCalledWith('node1');
      expect(result).toMatchObject({
        nodeId: 'node1',
        nodeName: 'Worker',
        networkLocation: 'LOCAL',
      });
    });

    it('should propagate errors', async () => {
      mockNodesService.findOne.mockRejectedValue(new Error('not found'));
      await expect(controller.getNodeCapabilities('missing')).rejects.toThrow('not found');
    });
  });

  describe('clearScoreCache', () => {
    it('should clear score cache and return success', async () => {
      const result = await controller.clearScoreCache();

      expect(mockJobAttribution.clearCache).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, message: 'Score cache cleared' });
    });
  });

  describe('getSshPublicKey', () => {
    it('should return the SSH public key', async () => {
      mockSshKeyService.getPublicKey.mockReturnValue(
        'ssh-rsa AAAAB3NzaC1... bitbonsai-cluster-node'
      );

      const result = await controller.getSshPublicKey();

      expect(mockSshKeyService.getPublicKey).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ publicKey: 'ssh-rsa AAAAB3NzaC1... bitbonsai-cluster-node' });
    });
  });

  describe('addAuthorizedKey', () => {
    it('should add an authorized SSH key and return success', async () => {
      const body = { publicKey: 'ssh-rsa AAAA... key', comment: 'main-node' };

      const result = await controller.addAuthorizedKey(body);

      expect(mockSshKeyService.addAuthorizedKey).toHaveBeenCalledWith(body.publicKey, body.comment);
      expect(result).toEqual({ success: true, message: 'SSH key added to authorized_keys' });
    });

    it('should propagate errors for invalid key format', async () => {
      mockSshKeyService.addAuthorizedKey.mockImplementation(() => {
        throw new Error('invalid key format');
      });
      await expect(controller.addAuthorizedKey({ publicKey: 'bad-key' })).rejects.toThrow(
        'invalid key format'
      );
    });
  });
});
