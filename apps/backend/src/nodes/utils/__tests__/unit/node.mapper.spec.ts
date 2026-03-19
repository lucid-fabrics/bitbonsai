import type { NodeRegistrationRequest, Node as PrismaNode } from '@prisma/client';
import {
  toCurrentNodeDto,
  toNodeResponseDto,
  toNodeResponseDtoArray,
  toRegistrationRequestResponseDto,
  toRegistrationRequestResponseDtoArray,
} from '../../node.mapper';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<PrismaNode> = {}): PrismaNode {
  return {
    id: 'node-1',
    name: 'Main Node',
    role: 'MAIN',
    status: 'ONLINE',
    version: '1.0.0',
    acceleration: 'CPU',
    lastHeartbeat: new Date('2024-01-01T00:00:00Z'),
    uptimeSeconds: 3600,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T01:00:00Z'),
    maxWorkers: 4,
    cpuLimit: 80,
    apiKey: 'secret-api-key',
    pairingToken: 'secret-pairing-token',
    pairingExpiresAt: new Date('2024-01-02T00:00:00Z'),
    licenseId: 'license-abc',
    mainNodeUrl: null,
    lastSyncedAt: null,
    ...overrides,
  } as unknown as PrismaNode;
}

function makeRegistrationRequest(
  overrides: Partial<NodeRegistrationRequest> = {}
): NodeRegistrationRequest {
  const base = new Date('2024-01-01T00:00:00Z');
  return {
    id: 'req-1',
    childNodeName: 'Child Node 1',
    childVersion: '1.0.0',
    ipAddress: '192.168.1.50',
    hostname: 'child-host',
    containerType: 'LXC',
    hardwareSpecs: {
      cpuCores: 8,
      cpuModel: 'Intel i7',
      ramGb: 16,
      diskGb: 500,
      gpuModel: null,
    },
    acceleration: 'CPU',
    pairingToken: 'token-xyz',
    tokenExpiresAt: new Date('2024-01-02T00:00:00Z'),
    status: 'PENDING',
    message: null,
    rejectionReason: null,
    childNodeId: null,
    macAddress: null,
    createdAt: base,
    updatedAt: base,
    ...overrides,
  } as unknown as NodeRegistrationRequest;
}

// ── toNodeResponseDto ─────────────────────────────────────────────────────────

describe('toNodeResponseDto', () => {
  it('maps all public fields', () => {
    const node = makeNode();
    const dto = toNodeResponseDto(node);

    expect(dto.id).toBe('node-1');
    expect(dto.name).toBe('Main Node');
    expect(dto.role).toBe('MAIN');
    expect(dto.status).toBe('ONLINE');
    expect(dto.version).toBe('1.0.0');
    expect(dto.acceleration).toBe('CPU');
    expect(dto.lastHeartbeat).toEqual(node.lastHeartbeat);
    expect(dto.uptimeSeconds).toBe(3600);
    expect(dto.createdAt).toEqual(node.createdAt);
    expect(dto.updatedAt).toEqual(node.updatedAt);
    expect(dto.maxWorkers).toBe(4);
    expect(dto.cpuLimit).toBe(80);
  });

  it('excludes sensitive fields: apiKey, pairingToken, pairingExpiresAt, licenseId', () => {
    const node = makeNode();
    const dto = toNodeResponseDto(node) as unknown as Record<string, unknown>;

    expect(dto.apiKey).toBeUndefined();
    expect(dto.pairingToken).toBeUndefined();
    expect(dto.pairingExpiresAt).toBeUndefined();
    expect(dto.licenseId).toBeUndefined();
  });
});

// ── toCurrentNodeDto ──────────────────────────────────────────────────────────

describe('toCurrentNodeDto', () => {
  it('maps minimal fields including mainNodeUrl', () => {
    const node = makeNode({ mainNodeUrl: 'http://192.168.1.100:3100/api/v1' });
    const dto = toCurrentNodeDto(node);

    expect(dto.id).toBe('node-1');
    expect(dto.name).toBe('Main Node');
    expect(dto.role).toBe('MAIN');
    expect(dto.status).toBe('ONLINE');
    expect(dto.version).toBe('1.0.0');
    expect(dto.acceleration).toBe('CPU');
    expect(dto.mainNodeUrl).toBe('http://192.168.1.100:3100/api/v1');
  });

  it('maps null mainNodeUrl for MAIN node', () => {
    const node = makeNode({ mainNodeUrl: null });
    const dto = toCurrentNodeDto(node);
    expect(dto.mainNodeUrl).toBeNull();
  });

  it('excludes sensitive fields', () => {
    const dto = toCurrentNodeDto(makeNode()) as unknown as Record<string, unknown>;
    expect(dto.apiKey).toBeUndefined();
    expect(dto.uptimeSeconds).toBeUndefined();
    expect(dto.maxWorkers).toBeUndefined();
  });
});

// ── toNodeResponseDtoArray ────────────────────────────────────────────────────

describe('toNodeResponseDtoArray', () => {
  it('maps an array of nodes', () => {
    const nodes = [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })];
    const dtos = toNodeResponseDtoArray(nodes);
    expect(dtos).toHaveLength(2);
    expect(dtos[0].id).toBe('n1');
    expect(dtos[1].id).toBe('n2');
  });

  it('returns empty array for empty input', () => {
    expect(toNodeResponseDtoArray([])).toEqual([]);
  });
});

// ── toRegistrationRequestResponseDto ─────────────────────────────────────────

describe('toRegistrationRequestResponseDto', () => {
  it('maps all fields correctly', () => {
    const req = makeRegistrationRequest();
    const dto = toRegistrationRequestResponseDto(req);

    expect(dto.id).toBe('req-1');
    expect(dto.childNodeName).toBe('Child Node 1');
    expect(dto.childVersion).toBe('1.0.0');
    expect(dto.ipAddress).toBe('192.168.1.50');
    expect(dto.hostname).toBe('child-host');
    expect(dto.containerType).toBe('LXC');
    expect(dto.acceleration).toBe('CPU');
    expect(dto.pairingToken).toBe('token-xyz');
    expect(dto.status).toBe('PENDING');
    expect(dto.hardwareSpecs).toEqual({
      cpuCores: 8,
      cpuModel: 'Intel i7',
      ramGb: 16,
      diskGb: 500,
      gpuModel: null,
    });
  });

  it('apiKey is always undefined', () => {
    const dto = toRegistrationRequestResponseDto(makeRegistrationRequest());
    expect(dto.apiKey).toBeUndefined();
  });

  it('respondedAt is undefined when updatedAt === createdAt', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    const req = makeRegistrationRequest({ createdAt: date, updatedAt: date });
    const dto = toRegistrationRequestResponseDto(req);
    expect(dto.respondedAt).toBeUndefined();
  });

  it('respondedAt is set when updatedAt !== createdAt', () => {
    const req = makeRegistrationRequest({
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T01:00:00Z'),
    });
    const dto = toRegistrationRequestResponseDto(req);
    expect(dto.respondedAt).toEqual(new Date('2024-01-01T01:00:00Z'));
  });

  it('message is undefined when null', () => {
    const dto = toRegistrationRequestResponseDto(makeRegistrationRequest({ message: null }));
    expect(dto.message).toBeUndefined();
  });

  it('message is returned when present', () => {
    const dto = toRegistrationRequestResponseDto(makeRegistrationRequest({ message: 'Approved' }));
    expect(dto.message).toBe('Approved');
  });

  it('rejectionReason is undefined when null', () => {
    const dto = toRegistrationRequestResponseDto(
      makeRegistrationRequest({ rejectionReason: null })
    );
    expect(dto.rejectionReason).toBeUndefined();
  });

  it('rejectionReason is returned when present', () => {
    const dto = toRegistrationRequestResponseDto(
      makeRegistrationRequest({ rejectionReason: 'Quota exceeded' })
    );
    expect(dto.rejectionReason).toBe('Quota exceeded');
  });

  it('childNodeId is undefined when null', () => {
    const dto = toRegistrationRequestResponseDto(makeRegistrationRequest({ childNodeId: null }));
    expect(dto.childNodeId).toBeUndefined();
  });

  it('childNodeId is returned when present', () => {
    const dto = toRegistrationRequestResponseDto(
      makeRegistrationRequest({ childNodeId: 'node-99' })
    );
    expect(dto.childNodeId).toBe('node-99');
  });

  it('requestedAt maps from createdAt', () => {
    const date = new Date('2024-06-15T12:00:00Z');
    const req = makeRegistrationRequest({ createdAt: date });
    const dto = toRegistrationRequestResponseDto(req);
    expect(dto.requestedAt).toEqual(date);
  });
});

// ── toRegistrationRequestResponseDtoArray ────────────────────────────────────

describe('toRegistrationRequestResponseDtoArray', () => {
  it('maps array of requests', () => {
    const requests = [makeRegistrationRequest({ id: 'r1' }), makeRegistrationRequest({ id: 'r2' })];
    const dtos = toRegistrationRequestResponseDtoArray(requests);
    expect(dtos).toHaveLength(2);
    expect(dtos[0].id).toBe('r1');
    expect(dtos[1].id).toBe('r2');
  });

  it('returns empty array for empty input', () => {
    expect(toRegistrationRequestResponseDtoArray([])).toEqual([]);
  });
});
