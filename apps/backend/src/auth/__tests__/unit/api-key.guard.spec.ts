import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { NodesService } from '../../../nodes/nodes.service';
import { ApiKeyGuard } from '../../guards/api-key.guard';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let nodesService: { findByApiKey: jest.Mock };

  const mockExecutionContext = (headers: Record<string, string> = {}): ExecutionContext => {
    const request = { headers, node: undefined };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      getArgs: () => [],
      getArgByIndex: () => null,
      switchToRpc: () => ({ getContext: jest.fn(), getData: jest.fn() }),
      switchToWs: () => ({ getClient: jest.fn(), getData: jest.fn(), getPattern: jest.fn() }),
      getType: () => 'http',
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    nodesService = {
      findByApiKey: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiKeyGuard, { provide: NodesService, useValue: nodesService }],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw UnauthorizedException when no API key is provided', async () => {
    const context = mockExecutionContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(context)).rejects.toThrow('API key required');
  });

  it('should throw UnauthorizedException for invalid API key', async () => {
    nodesService.findByApiKey.mockResolvedValue(null);
    const context = mockExecutionContext({ 'x-api-key': 'invalid-key' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(context)).rejects.toThrow('Invalid API key');
    expect(nodesService.findByApiKey).toHaveBeenCalledWith('invalid-key');
  });

  it('should return true and attach node for valid API key', async () => {
    const mockNode = { id: 'node-1', name: 'Test Node', role: 'LINKED' };
    nodesService.findByApiKey.mockResolvedValue(mockNode);
    const context = mockExecutionContext({ 'x-api-key': 'valid-key' });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(nodesService.findByApiKey).toHaveBeenCalledWith('valid-key');

    // Verify node is attached to request
    const request = context.switchToHttp().getRequest();
    expect(request.node).toEqual(mockNode);
  });
});
