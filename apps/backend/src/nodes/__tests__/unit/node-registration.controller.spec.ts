import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { NodeRegistrationController } from '../../controllers/node-registration.controller';
import { NodesService } from '../../nodes.service';
import { NodeDiscoveryService } from '../../services/node-discovery.service';
import { RegistrationRequestService } from '../../services/registration-request.service';
import { SshKeyService } from '../../services/ssh-key.service';

describe('NodeRegistrationController', () => {
  let controller: NodeRegistrationController;

  const mockNodesService = {
    registerNode: jest.fn(),
    pairNode: jest.fn(),
    generatePairingTokenForNode: jest.fn(),
    unregisterSelf: jest.fn(),
    getCurrentNode: jest.fn(),
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

  const mockSshKeyService = {
    getPublicKey: jest.fn(),
    addAuthorizedKey: jest.fn(),
  };

  const mockNode = {
    id: 'node-1',
    name: 'Main Node',
    role: 'MAIN' as const,
    status: 'ONLINE' as const,
    version: '1.0.0',
    acceleration: 'NONE' as const,
    lastHeartbeat: new Date('2024-01-01'),
    uptimeSeconds: 3600,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    maxWorkers: 4,
    cpuLimit: 100,
    apiKey: 'secret-key',
    pairingToken: null,
    pairingExpiresAt: null,
    licenseId: 'lic-1',
    mainNodeUrl: null,
    ipAddress: '192.168.1.100',
    hostname: 'main-host',
    containerType: null,
    hardwareSpecs: null,
    publicUrl: null,
  };

  const mockRegistrationRequest = {
    id: 'req-1',
    childNodeName: 'Child Node',
    childVersion: '1.0.0',
    ipAddress: '192.168.1.200',
    hostname: 'child-host',
    containerType: null,
    hardwareSpecs: null,
    acceleration: 'NONE' as const,
    pairingToken: '123456',
    tokenExpiresAt: new Date(Date.now() + 3600000),
    status: 'PENDING' as const,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    message: null,
    rejectionReason: null,
    childNodeId: null,
    mainNodeId: 'node-1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NodeRegistrationController],
      providers: [
        { provide: NodesService, useValue: mockNodesService },
        { provide: NodeDiscoveryService, useValue: mockNodeDiscoveryService },
        { provide: RegistrationRequestService, useValue: mockRegistrationRequestService },
        { provide: SshKeyService, useValue: mockSshKeyService },
      ],
    }).compile();

    controller = module.get<NodeRegistrationController>(NodeRegistrationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================================================
  // register
  // ============================================================================

  describe('register', () => {
    it('should delegate to nodesService.registerNode and return result', async () => {
      const dto = { licenseKey: 'lic-123', name: 'New Node' };
      const response = { apiKey: 'api-key', pairingToken: '654321', pairingExpiresAt: new Date() };
      mockNodesService.registerNode.mockResolvedValue(response);

      const result = await controller.register(dto as any);

      expect(mockNodesService.registerNode).toHaveBeenCalledWith(dto);
      expect(result).toEqual(response);
    });

    it('should propagate ConflictException when node limit exceeded', async () => {
      mockNodesService.registerNode.mockRejectedValue(
        new Error('Maximum nodes reached for this license')
      );

      await expect(controller.register({} as any)).rejects.toThrow(
        'Maximum nodes reached for this license'
      );
    });

    it('should propagate BadRequestException for invalid license', async () => {
      mockNodesService.registerNode.mockRejectedValue(new Error('Invalid license key'));

      await expect(controller.register({} as any)).rejects.toThrow('Invalid license key');
    });
  });

  // ============================================================================
  // pair
  // ============================================================================

  describe('pair', () => {
    it('should pair node and return NodeResponseDto', async () => {
      mockNodesService.pairNode.mockResolvedValue(mockNode);
      const dto = { pairingToken: '123456' };

      const result = await controller.pair(dto as any);

      expect(mockNodesService.pairNode).toHaveBeenCalledWith('123456');
      expect(result).toMatchObject({ id: 'node-1', name: 'Main Node' });
    });

    it('should strip sensitive fields from response', async () => {
      mockNodesService.pairNode.mockResolvedValue(mockNode);

      const result = await controller.pair({ pairingToken: '123456' } as any);

      expect((result as any).apiKey).toBeUndefined();
      expect((result as any).pairingToken).toBeUndefined();
    });

    it('should propagate NotFoundException for invalid/expired token', async () => {
      mockNodesService.pairNode.mockRejectedValue(
        new NotFoundException('Invalid or expired token')
      );

      await expect(controller.pair({ pairingToken: '000000' } as any)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ============================================================================
  // generatePairingToken
  // ============================================================================

  describe('generatePairingToken', () => {
    it('should generate a new pairing token for a node', async () => {
      const response = { apiKey: 'api-key', pairingToken: '999999', pairingExpiresAt: new Date() };
      mockNodesService.generatePairingTokenForNode.mockResolvedValue(response);

      const result = await controller.generatePairingToken('node-1');

      expect(mockNodesService.generatePairingTokenForNode).toHaveBeenCalledWith('node-1');
      expect(result).toEqual(response);
    });

    it('should propagate NotFoundException for unknown node', async () => {
      mockNodesService.generatePairingTokenForNode.mockRejectedValue(
        new NotFoundException('Node not found')
      );

      await expect(controller.generatePairingToken('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================================
  // unregisterSelf
  // ============================================================================

  describe('unregisterSelf', () => {
    it('should unregister the current node and return success', async () => {
      mockNodesService.unregisterSelf.mockResolvedValue({
        success: true,
        message: 'Successfully unregistered from main node',
      });

      const result = await controller.unregisterSelf();

      expect(mockNodesService.unregisterSelf).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        success: true,
        message: 'Successfully unregistered from main node',
      });
    });

    it('should propagate errors for MAIN nodes attempting unregister', async () => {
      mockNodesService.unregisterSelf.mockRejectedValue(
        new Error('Only LINKED nodes can unregister')
      );

      await expect(controller.unregisterSelf()).rejects.toThrow('Only LINKED nodes can unregister');
    });
  });

  // ============================================================================
  // discoverMainNodes
  // ============================================================================

  describe('discoverMainNodes', () => {
    it('should return list of discovered MAIN nodes', async () => {
      const nodes = [
        { nodeId: 'node-1', nodeName: 'Main', ipAddress: '192.168.1.100', port: 3100 },
      ];
      mockNodeDiscoveryService.discoverMainNodes.mockResolvedValue(nodes);

      const result = await controller.discoverMainNodes();

      expect(mockNodeDiscoveryService.discoverMainNodes).toHaveBeenCalledTimes(1);
      expect(result).toEqual(nodes);
    });

    it('should return empty array when no nodes found', async () => {
      mockNodeDiscoveryService.discoverMainNodes.mockResolvedValue([]);

      const result = await controller.discoverMainNodes();

      expect(result).toEqual([]);
    });
  });

  // ============================================================================
  // createRegistrationRequest
  // ============================================================================

  describe('createRegistrationRequest', () => {
    it('should create a registration request and return mapped dto', async () => {
      mockRegistrationRequestService.createRegistrationRequest.mockResolvedValue(
        mockRegistrationRequest
      );
      const createDto = { childNodeName: 'Child Node', ipAddress: '192.168.1.200' };

      const result = await controller.createRegistrationRequest(createDto as any);

      expect(mockRegistrationRequestService.createRegistrationRequest).toHaveBeenCalledWith(
        createDto
      );
      expect(result).toMatchObject({ id: 'req-1', status: 'PENDING' });
    });

    it('should propagate errors for invalid request data', async () => {
      mockRegistrationRequestService.createRegistrationRequest.mockRejectedValue(
        new Error('Invalid request data')
      );

      await expect(controller.createRegistrationRequest({} as any)).rejects.toThrow(
        'Invalid request data'
      );
    });
  });

  // ============================================================================
  // getPendingRequests
  // ============================================================================

  describe('getPendingRequests', () => {
    it('should return pending requests for current node', async () => {
      mockNodesService.getCurrentNode.mockResolvedValue({ id: 'node-1' });
      mockRegistrationRequestService.getPendingRequests.mockResolvedValue([
        mockRegistrationRequest,
      ]);

      const result = await controller.getPendingRequests();

      expect(mockNodesService.getCurrentNode).toHaveBeenCalledTimes(1);
      expect(mockRegistrationRequestService.getPendingRequests).toHaveBeenCalledWith('node-1');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });

    it('should return empty array when no pending requests', async () => {
      mockNodesService.getCurrentNode.mockResolvedValue({ id: 'node-1' });
      mockRegistrationRequestService.getPendingRequests.mockResolvedValue([]);

      const result = await controller.getPendingRequests();

      expect(result).toEqual([]);
    });
  });

  // ============================================================================
  // getRegistrationRequest
  // ============================================================================

  describe('getRegistrationRequest', () => {
    it('should return a specific registration request', async () => {
      mockRegistrationRequestService.getRequest.mockResolvedValue(mockRegistrationRequest);

      const result = await controller.getRegistrationRequest('req-1');

      expect(mockRegistrationRequestService.getRequest).toHaveBeenCalledWith('req-1');
      expect(result).toMatchObject({ id: 'req-1' });
    });

    it('should propagate NotFoundException for unknown request', async () => {
      mockRegistrationRequestService.getRequest.mockRejectedValue(
        new NotFoundException('Request not found')
      );

      await expect(controller.getRegistrationRequest('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================================
  // approveRegistrationRequest
  // ============================================================================

  describe('approveRegistrationRequest', () => {
    it('should approve a request and return updated dto', async () => {
      const approved = {
        ...mockRegistrationRequest,
        status: 'APPROVED' as const,
        childNodeId: 'node-2',
      };
      mockRegistrationRequestService.approveRequest.mockResolvedValue(approved);

      const result = await controller.approveRegistrationRequest('req-1', {});

      expect(mockRegistrationRequestService.approveRequest).toHaveBeenCalledWith('req-1', {});
      expect(result).toMatchObject({ id: 'req-1' });
    });

    it('should approve without optional approveDto', async () => {
      const approved = { ...mockRegistrationRequest, status: 'APPROVED' as const };
      mockRegistrationRequestService.approveRequest.mockResolvedValue(approved);

      const result = await controller.approveRegistrationRequest('req-1');

      expect(mockRegistrationRequestService.approveRequest).toHaveBeenCalledWith(
        'req-1',
        undefined
      );
      expect(result).toBeDefined();
    });

    it('should propagate NotFoundException for unknown request', async () => {
      mockRegistrationRequestService.approveRequest.mockRejectedValue(
        new NotFoundException('Request not found')
      );

      await expect(controller.approveRegistrationRequest('missing')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should propagate ConflictException when node limit exceeded', async () => {
      mockRegistrationRequestService.approveRequest.mockRejectedValue(
        new Error('Maximum nodes reached')
      );

      await expect(controller.approveRegistrationRequest('req-1')).rejects.toThrow(
        'Maximum nodes reached'
      );
    });
  });

  // ============================================================================
  // rejectRegistrationRequest
  // ============================================================================

  describe('rejectRegistrationRequest', () => {
    it('should reject a request and return updated dto', async () => {
      const rejected = {
        ...mockRegistrationRequest,
        status: 'REJECTED' as const,
        rejectionReason: 'Unauthorized device',
      };
      mockRegistrationRequestService.rejectRequest.mockResolvedValue(rejected);
      const rejectDto = { reason: 'Unauthorized device' };

      const result = await controller.rejectRegistrationRequest('req-1', rejectDto as any);

      expect(mockRegistrationRequestService.rejectRequest).toHaveBeenCalledWith('req-1', rejectDto);
      expect(result).toMatchObject({ id: 'req-1' });
    });

    it('should propagate NotFoundException for unknown request', async () => {
      mockRegistrationRequestService.rejectRequest.mockRejectedValue(
        new NotFoundException('Request not found')
      );

      await expect(controller.rejectRegistrationRequest('missing', {} as any)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ============================================================================
  // cancelRegistrationRequest
  // ============================================================================

  describe('cancelRegistrationRequest', () => {
    it('should cancel a request by ID', async () => {
      const cancelled = { ...mockRegistrationRequest, status: 'CANCELLED' as const };
      mockRegistrationRequestService.cancelRequest.mockResolvedValue(cancelled);

      const result = await controller.cancelRegistrationRequest('req-1');

      expect(mockRegistrationRequestService.cancelRequest).toHaveBeenCalledWith('req-1');
      expect(result).toMatchObject({ id: 'req-1' });
    });

    it('should propagate NotFoundException for unknown request', async () => {
      mockRegistrationRequestService.cancelRequest.mockRejectedValue(
        new NotFoundException('Request not found')
      );

      await expect(controller.cancelRegistrationRequest('missing')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ============================================================================
  // cancelRegistrationRequestByToken
  // ============================================================================

  describe('cancelRegistrationRequestByToken', () => {
    it('should cancel a request by pairing token', async () => {
      const cancelled = { ...mockRegistrationRequest, status: 'CANCELLED' as const };
      mockRegistrationRequestService.cancelRequestByToken.mockResolvedValue(cancelled);

      const result = await controller.cancelRegistrationRequestByToken('123456');

      expect(mockRegistrationRequestService.cancelRequestByToken).toHaveBeenCalledWith('123456');
      expect(result).toMatchObject({ id: 'req-1' });
    });

    it('should propagate NotFoundException for invalid token', async () => {
      mockRegistrationRequestService.cancelRequestByToken.mockRejectedValue(
        new NotFoundException('Invalid pairing token')
      );

      await expect(controller.cancelRegistrationRequestByToken('000000')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ============================================================================
  // getSshPublicKey
  // ============================================================================

  describe('getSshPublicKey', () => {
    it('should return the SSH public key', async () => {
      const publicKey = 'ssh-rsa AAAAB3NzaC1yc2E... bitbonsai-cluster-node';
      mockSshKeyService.getPublicKey.mockReturnValue(publicKey);

      const result = await controller.getSshPublicKey();

      expect(mockSshKeyService.getPublicKey).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ publicKey });
    });

    it('should return null publicKey when no key generated yet', async () => {
      mockSshKeyService.getPublicKey.mockReturnValue(null);

      const result = await controller.getSshPublicKey();

      expect(result).toEqual({ publicKey: null });
    });
  });

  // ============================================================================
  // addAuthorizedKey
  // ============================================================================

  describe('addAuthorizedKey', () => {
    it('should add an authorized SSH key and return success', async () => {
      mockSshKeyService.addAuthorizedKey.mockReturnValue(undefined);
      const body = { publicKey: 'ssh-rsa AAAAB...', comment: 'remote-node' };

      const result = await controller.addAuthorizedKey(body);

      expect(mockSshKeyService.addAuthorizedKey).toHaveBeenCalledWith(body.publicKey, body.comment);
      expect(result).toEqual({ success: true, message: 'SSH key added to authorized_keys' });
    });

    it('should add an authorized key without comment', async () => {
      mockSshKeyService.addAuthorizedKey.mockReturnValue(undefined);
      const body = { publicKey: 'ssh-rsa AAAAB...' };

      const result = await controller.addAuthorizedKey(body);

      expect(mockSshKeyService.addAuthorizedKey).toHaveBeenCalledWith(body.publicKey, undefined);
      expect(result.success).toBe(true);
    });
  });
});
