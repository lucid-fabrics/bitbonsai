import { Test, type TestingModule } from '@nestjs/testing';
import { RegistrationRequestService } from '../../../nodes/services/registration-request.service';
import { SystemInfoService } from '../../../nodes/services/system-info.service';
import { PolicySyncService } from '../../../sync/policy-sync.service';
import { DiscoveryController } from '../../discovery.controller';
import { PairingStatus } from '../../dto/pair-response.dto';
import { NodeDiscoveryService } from '../../node-discovery.service';

describe('DiscoveryController', () => {
  let controller: DiscoveryController;

  const mockDiscoveryService = {
    scanForMainNodes: jest.fn(),
    getDiscoveredNodes: jest.fn(),
    requestPairing: jest.fn(),
    completePairing: jest.fn(),
    approveNode: jest.fn(),
    rejectNode: jest.fn(),
  };

  const mockSyncService = {
    syncToChildNode: jest.fn(),
  };

  const mockRegistrationRequestService = {
    getRequest: jest.fn(),
  };

  const mockSystemInfoService = {
    collectSystemInfo: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DiscoveryController],
      providers: [
        { provide: NodeDiscoveryService, useValue: mockDiscoveryService },
        { provide: PolicySyncService, useValue: mockSyncService },
        { provide: RegistrationRequestService, useValue: mockRegistrationRequestService },
        { provide: SystemInfoService, useValue: mockSystemInfoService },
      ],
    }).compile();

    controller = module.get<DiscoveryController>(DiscoveryController);
    jest.clearAllMocks();
  });

  describe('scanForMainNodes', () => {
    it('should return discovered nodes with scan duration', async () => {
      const mockNodes = [
        { nodeId: 'node-1', name: 'Main Node', ipAddress: '192.168.1.100', apiPort: 3000 },
      ];
      mockDiscoveryService.scanForMainNodes.mockResolvedValue(mockNodes);

      const result = await controller.scanForMainNodes();

      expect(result.nodes).toEqual(mockNodes);
      expect(result.scanDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return empty nodes array when none found', async () => {
      mockDiscoveryService.scanForMainNodes.mockResolvedValue([]);

      const result = await controller.scanForMainNodes();

      expect(result.nodes).toEqual([]);
    });
  });

  describe('initiatePairing', () => {
    it('should return ERROR when main node not found in cache', async () => {
      mockDiscoveryService.getDiscoveredNodes.mockResolvedValue([]);

      const result = await controller.initiatePairing({
        mainNodeId: 'unknown-node',
        childNodeName: 'My Child',
      });

      expect(result.status).toBe(PairingStatus.ERROR);
      expect(result.message).toContain('not found');
    });

    it('should return WAITING_APPROVAL with pairing code on success', async () => {
      mockDiscoveryService.getDiscoveredNodes.mockResolvedValue([
        { nodeId: 'main-1', ipAddress: '192.168.1.100', apiPort: 3000 },
      ]);
      mockSystemInfoService.collectSystemInfo.mockResolvedValue({
        ipAddress: '192.168.1.101',
        hostname: 'child-node',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        subnet: '192.168.1.0/24',
        containerType: 'DOCKER',
        hardwareSpecs: { cpuCores: 4, ramGb: 16, diskGb: 500 },
        acceleration: 'CPU',
      });

      // Mock global fetch
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 'req-1',
          pairingToken: '123456',
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const result = await controller.initiatePairing({
        mainNodeId: 'main-1',
        childNodeName: 'My Child',
      });

      expect(result.status).toBe(PairingStatus.WAITING_APPROVAL);
      expect(result.pairingCode).toBe('123456');
      expect(result.requestId).toBe('req-1');
    });

    it('should return ERROR when main node fetch fails', async () => {
      mockDiscoveryService.getDiscoveredNodes.mockResolvedValue([
        { nodeId: 'main-1', ipAddress: '192.168.1.100', apiPort: 3000 },
      ]);
      mockSystemInfoService.collectSystemInfo.mockResolvedValue({
        ipAddress: '192.168.1.101',
        hostname: 'child',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        subnet: '192.168.1.0/24',
        containerType: 'DOCKER',
        hardwareSpecs: {},
        acceleration: 'CPU',
      });

      const mockResponse = {
        ok: false,
        json: jest.fn().mockResolvedValue({ message: 'Registration denied' }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const result = await controller.initiatePairing({
        mainNodeId: 'main-1',
        childNodeName: 'My Child',
      });

      expect(result.status).toBe(PairingStatus.ERROR);
      expect(result.message).toContain('Registration denied');
    });
  });

  describe('getPairingStatus', () => {
    it('should return WAITING_APPROVAL for PENDING request', async () => {
      mockRegistrationRequestService.getRequest.mockResolvedValue({
        status: 'PENDING',
        pairingToken: '123456',
      });

      const result = await controller.getPairingStatus('req-1');

      expect(result.status).toBe(PairingStatus.WAITING_APPROVAL);
      expect(result.pairingCode).toBe('123456');
    });

    it('should return APPROVED for approved request with childNodeId', async () => {
      mockRegistrationRequestService.getRequest.mockResolvedValue({
        status: 'APPROVED',
        childNodeId: 'child-1',
      });

      const result = await controller.getPairingStatus('req-1');

      expect(result.status).toBe(PairingStatus.APPROVED);
    });

    it('should return ERROR for approved request without childNodeId', async () => {
      mockRegistrationRequestService.getRequest.mockResolvedValue({
        status: 'APPROVED',
        childNodeId: null,
      });

      const result = await controller.getPairingStatus('req-1');

      expect(result.status).toBe(PairingStatus.ERROR);
    });

    it('should return REJECTED with reason', async () => {
      mockRegistrationRequestService.getRequest.mockResolvedValue({
        status: 'REJECTED',
        rejectionReason: 'Not authorized',
      });

      const result = await controller.getPairingStatus('req-1');

      expect(result.status).toBe(PairingStatus.REJECTED);
      expect(result.message).toContain('Not authorized');
    });

    it('should return TIMEOUT for expired request', async () => {
      mockRegistrationRequestService.getRequest.mockResolvedValue({
        status: 'EXPIRED',
      });

      const result = await controller.getPairingStatus('req-1');

      expect(result.status).toBe(PairingStatus.TIMEOUT);
    });

    it('should return ERROR for cancelled request', async () => {
      mockRegistrationRequestService.getRequest.mockResolvedValue({
        status: 'CANCELLED',
      });

      const result = await controller.getPairingStatus('req-1');

      expect(result.status).toBe(PairingStatus.ERROR);
      expect(result.message).toContain('cancelled');
    });

    it('should return ERROR when service throws', async () => {
      mockRegistrationRequestService.getRequest.mockRejectedValue(new Error('Request not found'));

      const result = await controller.getPairingStatus('bad-id');

      expect(result.status).toBe(PairingStatus.ERROR);
      expect(result.message).toContain('Request not found');
    });

    it('should handle unknown status', async () => {
      mockRegistrationRequestService.getRequest.mockResolvedValue({
        status: 'UNKNOWN_STATUS',
      });

      const result = await controller.getPairingStatus('req-1');

      expect(result.status).toBe(PairingStatus.ERROR);
      expect(result.message).toContain('Unknown status');
    });
  });

  describe('getDiscoveredNodes', () => {
    it('should return cached discovered nodes', async () => {
      const nodes = [{ nodeId: 'n-1', name: 'Node 1' }];
      mockDiscoveryService.getDiscoveredNodes.mockResolvedValue(nodes);

      const result = await controller.getDiscoveredNodes();

      expect(result).toEqual(nodes);
    });
  });

  describe('requestPairing', () => {
    it('should return pairing token with expiration', async () => {
      mockDiscoveryService.requestPairing.mockResolvedValue('654321');

      const result = await controller.requestPairing({
        mainNodeUrl: 'http://192.168.1.100:3000',
        mainNodeId: 'main-1',
      });

      expect(result.pairingToken).toBe('654321');
      expect(result.mainNodeUrl).toBe('http://192.168.1.100:3000');
      expect(result.expiresAt).toBeInstanceOf(Date);
      // Should expire ~10 minutes from now
      const diff = result.expiresAt.getTime() - Date.now();
      expect(diff).toBeLessThanOrEqual(10 * 60 * 1000);
      expect(diff).toBeGreaterThan(9 * 60 * 1000);
    });
  });

  describe('completePairing', () => {
    it('should return success with nodeId', async () => {
      mockDiscoveryService.completePairing.mockResolvedValue({
        nodeId: 'child-1',
        name: 'Child Node',
      });

      const result = await controller.completePairing({
        mainNodeUrl: 'http://192.168.1.100:3000',
        pairingToken: '123456',
      });

      expect(result.success).toBe(true);
      expect(result.nodeId).toBe('child-1');
      expect(result.message).toContain('Child Node');
    });
  });

  describe('approveNode', () => {
    it('should approve node and trigger background sync', async () => {
      mockDiscoveryService.approveNode.mockResolvedValue({ id: 'node-1' });
      mockSyncService.syncToChildNode.mockResolvedValue(undefined);

      const result = await controller.approveNode('node-1');

      expect(result.success).toBe(true);
      expect(result.nodeId).toBe('node-1');
      expect(mockSyncService.syncToChildNode).toHaveBeenCalledWith('node-1');
    });

    it('should still return success even if sync fails (background)', async () => {
      mockDiscoveryService.approveNode.mockResolvedValue({ id: 'node-1' });
      mockSyncService.syncToChildNode.mockRejectedValue(new Error('Sync failed'));

      const result = await controller.approveNode('node-1');

      expect(result.success).toBe(true);
    });
  });

  describe('rejectNode', () => {
    it('should reject node successfully', async () => {
      mockDiscoveryService.rejectNode.mockResolvedValue(undefined);

      const result = await controller.rejectNode('node-1');

      expect(result.success).toBe(true);
      expect(result.nodeId).toBe('node-1');
    });
  });

  describe('getHardwareDetection', () => {
    it('should return hardware info from system info service', async () => {
      mockSystemInfoService.collectSystemInfo.mockResolvedValue({
        acceleration: 'NVIDIA',
        hardwareSpecs: {
          cpuCores: 8,
          ramGb: 32,
          diskGb: 1000,
        },
      });

      const result = await controller.getHardwareDetection();

      expect(result.acceleration).toBe('NVIDIA');
      expect(result.cpuCores).toBe(8);
      expect(result.totalMemoryGB).toBe(32);
      expect(result.availableDiskGB).toBe(1000);
      expect(result.platform).toBe(process.platform);
      expect(result.nodeVersion).toBe(process.version);
    });
  });
});
