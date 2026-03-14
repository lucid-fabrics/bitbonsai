import { Test, type TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { LicenseController } from '../../license.controller';
import { LicenseService } from '../../license.service';
import { LicenseClientService } from '../../license-client.service';

describe('LicenseController', () => {
  let controller: LicenseController;

  const mockLicenseService = {
    createLicense: jest.fn(),
    validateLicense: jest.fn(),
    checkCanAddNode: jest.fn(),
  };

  const mockLicenseClientService = {
    verifyLicense: jest.fn(),
    getCurrentLimits: jest.fn(),
    setLicenseKey: jest.fn(),
    activateLicense: jest.fn(),
    lookupLicenseByEmail: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
      controllers: [LicenseController],
      providers: [
        { provide: LicenseService, useValue: mockLicenseService },
        { provide: LicenseClientService, useValue: mockLicenseClientService },
      ],
    }).compile();

    controller = module.get<LicenseController>(LicenseController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call licenseService.createLicense with dto and return result', async () => {
      const dto = { tier: 'FREE', email: 'test@example.com' } as never;
      const license = { id: 'lic-1', key: 'BITBONSAI-FREE-ABC123' };
      mockLicenseService.createLicense.mockResolvedValue(license);

      const result = await controller.create(dto);

      expect(mockLicenseService.createLicense).toHaveBeenCalledWith(dto);
      expect(result).toEqual(license);
    });

    it('should propagate service errors', async () => {
      mockLicenseService.createLicense.mockRejectedValue(new Error('create failed'));
      await expect(controller.create({} as never)).rejects.toThrow('create failed');
    });
  });

  describe('validate', () => {
    it('should call licenseService.validateLicense with key from dto', async () => {
      const dto = { key: 'BITBONSAI-FREE-ABC123' } as never;
      const licenseInfo = { valid: true, tier: 'FREE' };
      mockLicenseService.validateLicense.mockResolvedValue(licenseInfo);

      const result = await controller.validate(dto);

      expect(mockLicenseService.validateLicense).toHaveBeenCalledWith('BITBONSAI-FREE-ABC123');
      expect(result).toEqual(licenseInfo);
    });

    it('should propagate service errors', async () => {
      mockLicenseService.validateLicense.mockRejectedValue(new Error('invalid license'));
      await expect(controller.validate({ key: 'bad-key' } as never)).rejects.toThrow(
        'invalid license'
      );
    });
  });

  describe('canAddNode', () => {
    it('should call licenseService.checkCanAddNode with id and return wrapped result', async () => {
      mockLicenseService.checkCanAddNode.mockResolvedValue(true);

      const result = await controller.canAddNode('lic-1');

      expect(mockLicenseService.checkCanAddNode).toHaveBeenCalledWith('lic-1');
      expect(result).toEqual({ canAddNode: true });
    });

    it('should return canAddNode: false when limit reached', async () => {
      mockLicenseService.checkCanAddNode.mockResolvedValue(false);

      const result = await controller.canAddNode('lic-1');

      expect(result).toEqual({ canAddNode: false });
    });

    it('should propagate service errors', async () => {
      mockLicenseService.checkCanAddNode.mockRejectedValue(new Error('not found'));
      await expect(controller.canAddNode('missing')).rejects.toThrow('not found');
    });
  });

  describe('getCurrentLicense', () => {
    it('should call licenseClient.verifyLicense and return result', async () => {
      const licenseInfo = { tier: 'FREE', valid: true };
      mockLicenseClientService.verifyLicense.mockResolvedValue(licenseInfo);

      const result = await controller.getCurrentLicense();

      expect(mockLicenseClientService.verifyLicense).toHaveBeenCalledTimes(1);
      expect(result).toEqual(licenseInfo);
    });

    it('should propagate service errors', async () => {
      mockLicenseClientService.verifyLicense.mockRejectedValue(new Error('verify failed'));
      await expect(controller.getCurrentLicense()).rejects.toThrow('verify failed');
    });
  });

  describe('getCurrentLimits', () => {
    it('should call licenseClient.getCurrentLimits and return result', async () => {
      const limits = { maxNodes: 1, maxConcurrentJobs: 2 };
      mockLicenseClientService.getCurrentLimits.mockResolvedValue(limits);

      const result = await controller.getCurrentLimits();

      expect(mockLicenseClientService.getCurrentLimits).toHaveBeenCalledTimes(1);
      expect(result).toEqual(limits);
    });

    it('should propagate service errors', async () => {
      mockLicenseClientService.getCurrentLimits.mockRejectedValue(new Error('limits error'));
      await expect(controller.getCurrentLimits()).rejects.toThrow('limits error');
    });
  });

  describe('setLicenseKey', () => {
    it('should call licenseClient.setLicenseKey with key and return success response', async () => {
      const dto = { key: 'BITBONSAI-PRO-XYZ789' } as never;
      mockLicenseClientService.setLicenseKey.mockResolvedValue(undefined);

      const result = await controller.setLicenseKey(dto);

      expect(mockLicenseClientService.setLicenseKey).toHaveBeenCalledWith('BITBONSAI-PRO-XYZ789');
      expect(result).toEqual({ success: true, message: 'License key updated and verified' });
    });

    it('should propagate service errors', async () => {
      mockLicenseClientService.setLicenseKey.mockRejectedValue(new Error('invalid key'));
      await expect(controller.setLicenseKey({ key: 'bad' } as never)).rejects.toThrow(
        'invalid key'
      );
    });
  });

  describe('activateLicense', () => {
    it('should call licenseClient.activateLicense with key and email from dto', async () => {
      const dto = { key: 'BITBONSAI-PRO-XYZ789', email: 'user@example.com' } as never;
      const activation = { success: true, tier: 'PATREON_PRO' };
      mockLicenseClientService.activateLicense.mockResolvedValue(activation);

      const result = await controller.activateLicense(dto);

      expect(mockLicenseClientService.activateLicense).toHaveBeenCalledWith(
        'BITBONSAI-PRO-XYZ789',
        'user@example.com'
      );
      expect(result).toEqual(activation);
    });

    it('should propagate service errors', async () => {
      mockLicenseClientService.activateLicense.mockRejectedValue(new Error('activation failed'));
      await expect(
        controller.activateLicense({ key: 'bad', email: 'x@y.com' } as never)
      ).rejects.toThrow('activation failed');
    });
  });

  describe('lookupLicense', () => {
    it('should call licenseClient.lookupLicenseByEmail with email from dto', async () => {
      const dto = { email: 'user@example.com' } as never;
      const lookupResult = { found: true, licenseKey: 'BITBONSAI-PRO-XYZ789' };
      mockLicenseClientService.lookupLicenseByEmail.mockResolvedValue(lookupResult);

      const result = await controller.lookupLicense(dto);

      expect(mockLicenseClientService.lookupLicenseByEmail).toHaveBeenCalledWith(
        'user@example.com'
      );
      expect(result).toEqual(lookupResult);
    });

    it('should propagate service errors', async () => {
      mockLicenseClientService.lookupLicenseByEmail.mockRejectedValue(new Error('lookup error'));
      await expect(controller.lookupLicense({ email: 'x@y.com' } as never)).rejects.toThrow(
        'lookup error'
      );
    });
  });
});
