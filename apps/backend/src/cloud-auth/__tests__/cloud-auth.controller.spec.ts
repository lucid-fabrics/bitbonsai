import { Test, type TestingModule } from '@nestjs/testing';
import { CloudAuthController } from '../cloud-auth.controller';
import { CloudAuthService } from '../cloud-auth.service';

describe('CloudAuthController', () => {
  let controller: CloudAuthController;

  const mockCloudAuthService = {
    startDeviceFlow: jest.fn(),
    getStatus: jest.fn(),
    logout: jest.fn(),
    validateNow: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CloudAuthController],
      providers: [{ provide: CloudAuthService, useValue: mockCloudAuthService }],
    }).compile();

    controller = module.get<CloudAuthController>(CloudAuthController);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('startDeviceFlow (POST /cloud-auth/start)', () => {
    it('calls startDeviceFlow with machineName from body', async () => {
      const expected = {
        userCode: 'ABCD-1234',
        verificationUri: 'https://bitbonsai.app/activate',
        verificationUriComplete: 'https://bitbonsai.app/activate?code=ABCD-1234',
        expiresIn: 900,
        interval: 5,
        deviceCode: 'device-code-xyz',
      };
      mockCloudAuthService.startDeviceFlow.mockResolvedValue(expected);

      const result = await controller.startDeviceFlow({ machineName: 'My Mac' });

      expect(mockCloudAuthService.startDeviceFlow).toHaveBeenCalledWith('My Mac');
      expect(result).toEqual(expected);
    });

    it('calls startDeviceFlow with undefined when machineName is absent', async () => {
      mockCloudAuthService.startDeviceFlow.mockResolvedValue({});

      await controller.startDeviceFlow({});

      expect(mockCloudAuthService.startDeviceFlow).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getStatus (GET /cloud-auth/status)', () => {
    it('returns the result of getStatus', async () => {
      const expected = {
        linked: true,
        email: 'user@example.com',
        tier: 'SUPPORTER',
        maxNodes: 3,
        maxConcurrentJobs: 6,
        validatedAt: new Date('2026-05-01T00:00:00Z'),
        gracePeriodExpiresAt: new Date('2026-05-08T00:00:00Z'),
        gracePeriodExpired: false,
      };
      mockCloudAuthService.getStatus.mockResolvedValue(expected);

      const result = await controller.getStatus();

      expect(mockCloudAuthService.getStatus).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expected);
    });

    it('returns unlinked status when not linked', async () => {
      const expected = {
        linked: false,
        email: null,
        tier: null,
        maxNodes: null,
        maxConcurrentJobs: null,
        validatedAt: null,
        gracePeriodExpiresAt: null,
        gracePeriodExpired: false,
      };
      mockCloudAuthService.getStatus.mockResolvedValue(expected);

      const result = await controller.getStatus();

      expect(result).toEqual(expected);
    });
  });

  describe('logout (POST /cloud-auth/logout)', () => {
    it('calls logout and resolves', async () => {
      mockCloudAuthService.logout.mockResolvedValue(undefined);

      const result = await controller.logout();

      expect(mockCloudAuthService.logout).toHaveBeenCalledTimes(1);
      expect(result).toBeUndefined();
    });
  });

  describe('validateNow (POST /cloud-auth/validate)', () => {
    it('calls validateNow and returns true when validation succeeds', async () => {
      mockCloudAuthService.validateNow.mockResolvedValue(true);

      const result = await controller.validateNow();

      expect(mockCloudAuthService.validateNow).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('calls validateNow and returns false when validation fails', async () => {
      mockCloudAuthService.validateNow.mockResolvedValue(false);

      const result = await controller.validateNow();

      expect(result).toBe(false);
    });
  });
});
