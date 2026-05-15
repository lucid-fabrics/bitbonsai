import { Test, type TestingModule } from '@nestjs/testing';
import { NodeType } from '../../dto/initialize-setup.dto';
import { SetupController } from '../../setup.controller';
import { SetupService } from '../../setup.service';

describe('SetupController', () => {
  let controller: SetupController;
  let setupService: jest.Mocked<SetupService>;

  beforeEach(async () => {
    const mockSetupService = {
      getSetupStatus: jest.fn(),
      initializeSetup: jest.fn(),
      resetSetup: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SetupController],
      providers: [{ provide: SetupService, useValue: mockSetupService }],
    }).compile();

    controller = module.get<SetupController>(SetupController);
    setupService = module.get(SetupService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ==========================================================================
  // GET /setup/status
  // ==========================================================================
  describe('getSetupStatus', () => {
    it('should return setup status from service', async () => {
      setupService.getSetupStatus.mockResolvedValue({ isSetupComplete: false });

      const result = await controller.getSetupStatus();

      expect(result).toEqual({ isSetupComplete: false });
      expect(setupService.getSetupStatus).toHaveBeenCalled();
    });

    it('should return complete status', async () => {
      setupService.getSetupStatus.mockResolvedValue({ isSetupComplete: true });

      const result = await controller.getSetupStatus();

      expect(result).toEqual({ isSetupComplete: true });
    });
  });

  // ==========================================================================
  // POST /setup/initialize
  // ==========================================================================
  describe('initializeSetup', () => {
    it('should delegate main node setup to service', async () => {
      const dto = {
        username: 'admin',
        password: 'securePass1',
        allowLocalNetworkWithoutAuth: false,
        nodeType: NodeType.Main,
      };
      setupService.initializeSetup.mockResolvedValue({
        message: 'Setup completed successfully',
      });

      const result = await controller.initializeSetup(dto);

      expect(result).toEqual({ message: 'Setup completed successfully' });
      expect(setupService.initializeSetup).toHaveBeenCalledWith(dto);
    });

    it('should delegate child node setup to service', async () => {
      const dto = {
        allowLocalNetworkWithoutAuth: false,
        nodeType: NodeType.Child,
        mainNodeUrl: 'http://192.168.1.100:3100',
      };
      setupService.initializeSetup.mockResolvedValue({
        message: 'Child node setup completed. Use the pairing token to connect to a main node.',
        pairingToken: 'BITBONSAI-ABCD1234',
      });

      const result = await controller.initializeSetup(dto);

      expect((result as any).pairingToken).toBe('BITBONSAI-ABCD1234');
      expect(setupService.initializeSetup).toHaveBeenCalledWith(dto);
    });

    it('should propagate service errors', async () => {
      const dto = {
        username: 'admin',
        password: 'securePass1',
        allowLocalNetworkWithoutAuth: false,
      };
      setupService.initializeSetup.mockRejectedValue(new Error('Setup has already been completed'));

      await expect(controller.initializeSetup(dto)).rejects.toThrow(
        'Setup has already been completed'
      );
    });
  });

  // ==========================================================================
  // DELETE /setup/reset
  // ==========================================================================
  describe('resetSetup', () => {
    it('should delegate reset to service', async () => {
      setupService.resetSetup.mockResolvedValue({
        message: 'Setup reset successfully. You can now run first-time setup again.',
      });

      const result = await controller.resetSetup();

      expect(result.message).toContain('Setup reset successfully');
      expect(setupService.resetSetup).toHaveBeenCalled();
    });

    it('should propagate production guard errors', async () => {
      setupService.resetSetup.mockRejectedValue(
        new Error('Reset setup is not allowed in production')
      );

      await expect(controller.resetSetup()).rejects.toThrow(
        'Reset setup is not allowed in production'
      );
    });
  });
});
