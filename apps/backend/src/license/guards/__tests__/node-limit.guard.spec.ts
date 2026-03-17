import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { LicenseClientService } from '../../license-client.service';
import { NodeLimitGuard } from '../node-limit.guard';

describe('NodeLimitGuard', () => {
  let guard: NodeLimitGuard;
  let licenseClient: Record<string, jest.Mock>;
  let prisma: Record<string, Record<string, jest.Mock>>;

  const mockExecutionContext = (): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({}),
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
    licenseClient = {
      getCurrentLimits: jest.fn(),
    };

    prisma = {
      node: {
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodeLimitGuard,
        { provide: LicenseClientService, useValue: licenseClient },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get<NodeLimitGuard>(NodeLimitGuard);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow when node count is below limit', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 5, maxConcurrentJobs: 10 });
    prisma.node.count.mockResolvedValue(3);

    const result = await guard.canActivate(mockExecutionContext());

    expect(result).toBe(true);
  });

  it('should throw ForbiddenException when node limit is reached', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 2, maxConcurrentJobs: 10 });
    prisma.node.count.mockResolvedValue(2);

    await expect(guard.canActivate(mockExecutionContext())).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(mockExecutionContext())).rejects.toThrow(
      /Node limit reached \(2\/2\)/
    );
  });

  it('should throw ForbiddenException when node count exceeds limit', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 1, maxConcurrentJobs: 10 });
    prisma.node.count.mockResolvedValue(5);

    await expect(guard.canActivate(mockExecutionContext())).rejects.toThrow(ForbiddenException);
  });

  it('should allow when at zero nodes with limit of 1', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 1, maxConcurrentJobs: 10 });
    prisma.node.count.mockResolvedValue(0);

    const result = await guard.canActivate(mockExecutionContext());

    expect(result).toBe(true);
  });

  it('should count only ONLINE and OFFLINE nodes (exclude ERROR)', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 5, maxConcurrentJobs: 10 });
    prisma.node.count.mockResolvedValue(2);

    await guard.canActivate(mockExecutionContext());

    expect(prisma.node.count).toHaveBeenCalledWith({
      where: {
        status: { in: ['ONLINE', 'OFFLINE'] },
      },
    });
  });

  it('should include upgrade message in error', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 1, maxConcurrentJobs: 10 });
    prisma.node.count.mockResolvedValue(1);

    try {
      await guard.canActivate(mockExecutionContext());
      fail('Should have thrown');
    } catch (error) {
      expect((error as ForbiddenException).message).toContain('Upgrade your license');
    }
  });

  it('should propagate errors from license client', async () => {
    licenseClient.getCurrentLimits.mockRejectedValue(new Error('License service down'));

    await expect(guard.canActivate(mockExecutionContext())).rejects.toThrow('License service down');
  });
});
