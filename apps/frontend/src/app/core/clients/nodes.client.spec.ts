import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Node } from '../../features/nodes/models/node.model';
import { AccelerationType, NodeRole, NodeStatus } from '../../features/nodes/models/node.model';
import {
  type NodeStats,
  NodesClient,
  type PairRequest,
  type PairResponse,
  type RegisterResponse,
} from './nodes.client';

describe('NodesClient', () => {
  let client: NodesClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [NodesClient],
    });
    client = TestBed.inject(NodesClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(client).toBeTruthy();
  });

  describe('getNodes', () => {
    it('should fetch all nodes', () => {
      const mockNodes: Node[] = [
        {
          id: 'node-1',
          name: 'Worker 1',
          status: NodeStatus.ONLINE,
          role: NodeRole.WORKER,
          accelerationType: AccelerationType.NVIDIA,
          ipAddress: '192.168.1.100',
          lastSeen: '2024-01-01T00:00:00Z',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'node-2',
          name: 'Worker 2',
          status: NodeStatus.OFFLINE,
          role: NodeRole.WORKER,
          accelerationType: AccelerationType.CPU,
          ipAddress: '192.168.1.101',
          lastSeen: '2024-01-01T00:00:00Z',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      client.getNodes().subscribe((data) => {
        expect(data).toEqual(mockNodes);
        expect(data.length).toBe(2);
        expect(data[0].name).toBe('Worker 1');
        expect(data[0].status).toBe(NodeStatus.ONLINE);
        expect(data[1].status).toBe(NodeStatus.OFFLINE);
      });

      const req = httpMock.expectOne('/api/v1/nodes');
      expect(req.request.method).toBe('GET');
      req.flush(mockNodes);
    });

    it('should handle errors when fetching nodes', () => {
      client.getNodes().subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(500);
        },
      });

      const req = httpMock.expectOne('/api/v1/nodes');
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getNode', () => {
    it('should fetch a specific node by ID', () => {
      const mockNode: Node = {
        id: 'node-1',
        name: 'Worker 1',
        status: NodeStatus.ONLINE,
        role: NodeRole.WORKER,
        accelerationType: AccelerationType.NVIDIA,
        ipAddress: '192.168.1.100',
        lastSeen: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      client.getNode('node-1').subscribe((data) => {
        expect(data).toEqual(mockNode);
        expect(data.id).toBe('node-1');
        expect(data.name).toBe('Worker 1');
      });

      const req = httpMock.expectOne('/api/v1/nodes/node-1');
      expect(req.request.method).toBe('GET');
      req.flush(mockNode);
    });

    it('should handle 404 when node not found', () => {
      client.getNode('node-999').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/v1/nodes/node-999');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });
  });

  describe('register', () => {
    it('should initiate node registration', () => {
      const mockResponse: RegisterResponse = {
        message: 'Node registration initiated',
        command: 'curl -X POST http://api.example.com/register',
        expiresIn: 300,
      };

      client.register().subscribe((data) => {
        expect(data).toEqual(mockResponse);
        expect(data.expiresIn).toBe(300);
        expect(data.command).toContain('curl');
      });

      const req = httpMock.expectOne('/api/v1/nodes/register');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush(mockResponse);
    });

    it('should handle errors when registering node', () => {
      client.register().subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(500);
        },
      });

      const req = httpMock.expectOne('/api/v1/nodes/register');
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('pair', () => {
    it('should complete node pairing with code', () => {
      const pairRequest: PairRequest = {
        code: '123456',
      };

      const mockResponse: PairResponse = {
        success: true,
        node: {
          id: 'node-3',
          name: 'Worker 3',
          status: NodeStatus.ONLINE,
          role: NodeRole.WORKER,
          accelerationType: AccelerationType.AMD,
          ipAddress: '192.168.1.102',
          lastSeen: '2024-01-01T00:00:00Z',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      };

      client.pair(pairRequest).subscribe((data) => {
        expect(data).toEqual(mockResponse);
        expect(data.success).toBe(true);
        expect(data.node.id).toBe('node-3');
      });

      const req = httpMock.expectOne('/api/v1/nodes/pair');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(pairRequest);
      req.flush(mockResponse);
    });

    it('should handle invalid pairing code', () => {
      const pairRequest: PairRequest = {
        code: '000000',
      };

      client.pair(pairRequest).subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(400);
        },
      });

      const req = httpMock.expectOne('/api/v1/nodes/pair');
      req.flush('Invalid code', { status: 400, statusText: 'Bad Request' });
    });

    it('should handle expired pairing code', () => {
      const pairRequest: PairRequest = {
        code: '123456',
      };

      client.pair(pairRequest).subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(410);
        },
      });

      const req = httpMock.expectOne('/api/v1/nodes/pair');
      req.flush('Code expired', { status: 410, statusText: 'Gone' });
    });
  });

  describe('getNodeStats', () => {
    it('should fetch node statistics', () => {
      const mockStats: NodeStats = {
        nodeId: 'node-1',
        cpuUsage: 45.5,
        memoryUsage: 60.2,
        diskUsage: 75.8,
        activeJobs: 3,
        completedJobs: 150,
        failedJobs: 5,
      };

      client.getNodeStats('node-1').subscribe((data) => {
        expect(data).toEqual(mockStats);
        expect(data.nodeId).toBe('node-1');
        expect(data.cpuUsage).toBe(45.5);
        expect(data.activeJobs).toBe(3);
      });

      const req = httpMock.expectOne('/api/v1/nodes/node-1/stats');
      expect(req.request.method).toBe('GET');
      req.flush(mockStats);
    });

    it('should handle errors when fetching node stats', () => {
      client.getNodeStats('node-999').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/v1/nodes/node-999/stats');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });
  });

  describe('deleteNode', () => {
    it('should delete a node', () => {
      client.deleteNode('node-1').subscribe((response) => {
        expect(response).toBeUndefined();
      });

      const req = httpMock.expectOne('/api/v1/nodes/node-1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });

    it('should handle errors when deleting node', () => {
      client.deleteNode('node-999').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/v1/nodes/node-999');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });

    it('should handle conflict when deleting node with active jobs', () => {
      client.deleteNode('node-1').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(409);
        },
      });

      const req = httpMock.expectOne('/api/v1/nodes/node-1');
      req.flush('Node has active jobs', { status: 409, statusText: 'Conflict' });
    });
  });
});
