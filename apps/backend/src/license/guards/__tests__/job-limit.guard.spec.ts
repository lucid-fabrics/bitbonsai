import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LicenseClientService } from '../../license-client.service';
import { JobLimitGuard } from '../job-limit.guard';

describe('JobLimitGuard', () => {
  let guard: JobLimitGuard;
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
      job: {
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobLimitGuard,
        { provide: LicenseClientService, useValue: licenseClient },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get<JobLimitGuard>(JobLimitGuard);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow when concurrent jobs are below limit', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 5, maxConcurrentJobs: 10 });
    prisma.job.count.mockResolvedValue(5);

    const result = await guard.canActivate(mockExecutionContext());

    expect(result).toBe(true);
  });

  it('should throw ForbiddenException when job limit is reached', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 5, maxConcurrentJobs: 4 });
    prisma.job.count.mockResolvedValue(4);

    await expect(guard.canActivate(mockExecutionContext())).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(mockExecutionContext())).rejects.toThrow(
      /Concurrent job limit reached \(4\/4\)/
    );
  });

  it('should throw ForbiddenException when jobs exceed limit', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 5, maxConcurrentJobs: 2 });
    prisma.job.count.mockResolvedValue(10);

    await expect(guard.canActivate(mockExecutionContext())).rejects.toThrow(ForbiddenException);
  });

  it('should allow when zero jobs are encoding', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 5, maxConcurrentJobs: 1 });
    prisma.job.count.mockResolvedValue(0);

    const result = await guard.canActivate(mockExecutionContext());

    expect(result).toBe(true);
  });

  it('should only count ENCODING stage jobs', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 5, maxConcurrentJobs: 10 });
    prisma.job.count.mockResolvedValue(3);

    await guard.canActivate(mockExecutionContext());

    expect(prisma.job.count).toHaveBeenCalledWith({
      where: {
        stage: JobStage.ENCODING,
      },
    });
  });

  it('should include upgrade message in error', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 5, maxConcurrentJobs: 2 });
    prisma.job.count.mockResolvedValue(2);

    try {
      await guard.canActivate(mockExecutionContext());
      fail('Should have thrown');
    } catch (error: unknown) {
      expect((error as ForbiddenException).message).toContain('Upgrade your license');
    }
  });

  it('should propagate errors from license client', async () => {
    licenseClient.getCurrentLimits.mockRejectedValue(new Error('Service unavailable'));

    await expect(guard.canActivate(mockExecutionContext())).rejects.toThrow('Service unavailable');
  });

  it('should handle maxConcurrentJobs of 0 (all blocked)', async () => {
    licenseClient.getCurrentLimits.mockResolvedValue({ maxNodes: 5, maxConcurrentJobs: 0 });
    prisma.job.count.mockResolvedValue(0);

    // 0 >= 0 is true, so should block
    await expect(guard.canActivate(mockExecutionContext())).rejects.toThrow(ForbiddenException);
  });
});
