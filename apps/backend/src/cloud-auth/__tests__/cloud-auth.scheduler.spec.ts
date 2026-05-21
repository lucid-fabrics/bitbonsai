import { Test, type TestingModule } from '@nestjs/testing';
import { CloudAuthScheduler } from '../cloud-auth.scheduler';
import { CloudAuthService } from '../cloud-auth.service';

describe('CloudAuthScheduler', () => {
  let scheduler: CloudAuthScheduler;

  const mockCloudAuthService = {
    validateNow: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudAuthScheduler,
        { provide: CloudAuthService, useValue: mockCloudAuthService },
      ],
    }).compile();

    scheduler = module.get<CloudAuthScheduler>(CloudAuthScheduler);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(scheduler).toBeDefined();
  });

  describe('revalidateEntitlements', () => {
    it('logs debug when validateNow returns true', async () => {
      mockCloudAuthService.validateNow.mockResolvedValue(true);
      const debugSpy = jest
        .spyOn((scheduler as any).logger, 'debug')
        .mockImplementation(() => undefined);

      await scheduler.revalidateEntitlements();

      expect(mockCloudAuthService.validateNow).toHaveBeenCalledTimes(1);
      expect(debugSpy).toHaveBeenCalledWith('Entitlements revalidated');
    });

    it('does not log debug when validateNow returns false', async () => {
      mockCloudAuthService.validateNow.mockResolvedValue(false);
      const debugSpy = jest
        .spyOn((scheduler as any).logger, 'debug')
        .mockImplementation(() => undefined);

      await scheduler.revalidateEntitlements();

      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('propagates errors thrown by validateNow', async () => {
      mockCloudAuthService.validateNow.mockRejectedValue(new Error('DB connection lost'));

      await expect(scheduler.revalidateEntitlements()).rejects.toThrow('DB connection lost');
    });
  });
});
