import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { LicenseRepository } from '../../../common/repositories/license.repository';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { SettingsRepository } from '../../../common/repositories/settings.repository';
import { UserRepository } from '../../../common/repositories/user.repository';
import { NodeType } from '../../dto/initialize-setup.dto';
import { SetupService } from '../../setup.service';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password_abc'),
}));

// Mock crypto
jest.mock('crypto', () => ({
  randomBytes: jest.fn().mockReturnValue({
    toString: jest.fn().mockReturnValue('ABCDEFGHIJKL'),
  }),
  randomInt: jest.fn().mockReturnValue(123456),
}));

describe('SetupService', () => {
  let service: SetupService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let mockLicenseRepository: { findFirstWhere: jest.Mock; createLicense: jest.Mock };
  let mockNodeRepository: { findFirstByRole: jest.Mock; createNode: jest.Mock };
  let mockSettingsRepository: {
    findFirst: jest.Mock;
    upsertSettings: jest.Mock;
    update: jest.Mock;
  };
  let mockUserRepository: { count: jest.Mock; create: jest.Mock; deleteMany: jest.Mock };

  function createMockPrisma() {
    return {
      node: { findFirst: jest.fn(), create: jest.fn() },
      user: { count: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
      settings: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      license: { findFirst: jest.fn(), create: jest.fn() },
    };
  }

  beforeEach(async () => {
    prisma = createMockPrisma();

    mockLicenseRepository = {
      findFirstWhere: prisma.license.findFirst,
      createLicense: jest.fn().mockImplementation(async (data: unknown) => {
        return prisma.license.create({ data });
      }),
    };

    mockNodeRepository = {
      findFirstByRole: prisma.node.findFirst,
      createNode: prisma.node.create,
    };

    mockSettingsRepository = {
      findFirst: prisma.settings.findFirst,
      upsertSettings: jest.fn().mockImplementation(async () => {
        return prisma.settings.update() ?? prisma.settings.create();
      }),
      update: jest.fn().mockImplementation(async (_where: unknown, data: unknown) => {
        return prisma.settings.update({ where: _where, data });
      }),
    };

    mockUserRepository = {
      count: prisma.user.count,
      create: prisma.user.create,
      deleteMany: prisma.user.deleteMany,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupService,
        { provide: LicenseRepository, useValue: mockLicenseRepository },
        { provide: NodeRepository, useValue: mockNodeRepository },
        { provide: SettingsRepository, useValue: mockSettingsRepository },
        { provide: UserRepository, useValue: mockUserRepository },
      ],
    }).compile();

    service = module.get<SetupService>(SetupService);
  });

  // ==========================================================================
  // getSetupStatus
  // ==========================================================================
  describe('getSetupStatus', () => {
    it('should return false when MAIN node has no users (recovery mode)', async () => {
      prisma.node.findFirst.mockResolvedValue(null); // No LINKED node
      prisma.user.count.mockResolvedValue(0);

      const result = await service.getSetupStatus();

      expect(result).toEqual({ isSetupComplete: false });
    });

    it('should check explicit flag when MAIN node has users', async () => {
      prisma.node.findFirst.mockResolvedValue(null); // No LINKED node
      prisma.user.count.mockResolvedValue(1);
      prisma.settings.findFirst.mockResolvedValue({ isSetupComplete: true });

      const result = await service.getSetupStatus();

      expect(result).toEqual({ isSetupComplete: true });
    });

    it('should return false when MAIN node has users but no settings', async () => {
      prisma.node.findFirst.mockResolvedValue(null);
      prisma.user.count.mockResolvedValue(1);
      prisma.settings.findFirst.mockResolvedValue(null);

      const result = await service.getSetupStatus();

      expect(result).toEqual({ isSetupComplete: false });
    });

    it('should skip user check for LINKED (child) nodes', async () => {
      prisma.node.findFirst.mockResolvedValue({ role: 'LINKED' });
      prisma.settings.findFirst.mockResolvedValue({ isSetupComplete: true });

      const result = await service.getSetupStatus();

      expect(result).toEqual({ isSetupComplete: true });
      expect(prisma.user.count).not.toHaveBeenCalled();
    });

    it('should return false for LINKED node with no settings', async () => {
      prisma.node.findFirst.mockResolvedValue({ role: 'LINKED' });
      prisma.settings.findFirst.mockResolvedValue(null);

      const result = await service.getSetupStatus();

      expect(result).toEqual({ isSetupComplete: false });
    });
  });

  // ==========================================================================
  // initializeSetup
  // ==========================================================================
  describe('initializeSetup', () => {
    const baseLicense = {
      id: 'license-1',
      key: 'FREE-abc',
      tier: 'FREE',
      status: 'ACTIVE',
    };

    it('should throw if setup already completed (users exist)', async () => {
      prisma.user.count.mockResolvedValue(1);

      await expect(
        service.initializeSetup({
          username: 'admin',
          password: 'password123',
          allowLocalNetworkWithoutAuth: false,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if main node setup missing username', async () => {
      prisma.user.count.mockResolvedValue(0);

      await expect(
        service.initializeSetup({
          nodeType: NodeType.Main,
          allowLocalNetworkWithoutAuth: false,
        })
      ).rejects.toThrow('Username and password are required for main node setup');
    });

    it('should throw if main node setup missing password', async () => {
      prisma.user.count.mockResolvedValue(0);

      await expect(
        service.initializeSetup({
          username: 'admin',
          nodeType: NodeType.Main,
          allowLocalNetworkWithoutAuth: false,
        })
      ).rejects.toThrow('Username and password are required for main node setup');
    });

    it('should create admin user and MAIN node on main setup', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({});
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(null);
      prisma.license.create.mockResolvedValue(baseLicense);
      prisma.node.create.mockResolvedValue({});

      const result = await service.initializeSetup({
        username: 'admin',
        password: 'securePass1',
        allowLocalNetworkWithoutAuth: false,
        nodeType: NodeType.Main,
      });

      expect(result.message).toBe('Setup completed successfully');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'admin',
          email: 'admin@local.bitbonsai',
          role: 'ADMIN',
          passwordHash: 'hashed_password_abc',
        })
      );
      expect(prisma.node.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'MAIN',
          status: 'ONLINE',
        })
      );
    });

    it('should update existing settings instead of creating new', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({});
      prisma.settings.findFirst.mockResolvedValue({ id: 'settings-1' });
      prisma.settings.update.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(baseLicense);
      prisma.node.create.mockResolvedValue({});

      await service.initializeSetup({
        username: 'admin',
        password: 'securePass1',
        allowLocalNetworkWithoutAuth: true,
        nodeType: NodeType.Main,
      });

      expect(mockSettingsRepository.upsertSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          isSetupComplete: true,
          allowLocalNetworkWithoutAuth: true,
        })
      );
      expect(prisma.settings.create).not.toHaveBeenCalled();
    });

    it('should reuse existing license if one exists', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({});
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(baseLicense);
      prisma.node.create.mockResolvedValue({});

      await service.initializeSetup({
        username: 'admin',
        password: 'securePass1',
        allowLocalNetworkWithoutAuth: false,
        nodeType: NodeType.Main,
      });

      expect(prisma.license.create).not.toHaveBeenCalled();
      expect(prisma.node.create).toHaveBeenCalledWith(
        expect.objectContaining({ licenseId: 'license-1' })
      );
    });

    it('should create LINKED node and return pairing token for child setup', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(baseLicense);
      prisma.node.create.mockResolvedValue({});

      const result = await service.initializeSetup({
        allowLocalNetworkWithoutAuth: false,
        nodeType: NodeType.Child,
        mainNodeUrl: 'http://192.168.1.100:3100',
      });

      expect(result.pairingToken).not.toBeNull();
      expect(result.pairingToken).toMatch(/^BITBONSAI-/);
      expect(prisma.node.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'LINKED',
          mainNodeUrl: 'http://192.168.1.100:3100',
        })
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should default to main node when nodeType is not specified', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({});
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(null);
      prisma.license.create.mockResolvedValue(baseLicense);
      prisma.node.create.mockResolvedValue({});

      const result = await service.initializeSetup({
        username: 'admin',
        password: 'securePass1',
        allowLocalNetworkWithoutAuth: false,
      });

      expect(result.message).toBe('Setup completed successfully');
      expect(prisma.user.create).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // resetSetup
  // ==========================================================================
  describe('resetSetup', () => {
    it('should throw in production environment', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      await expect(service.resetSetup()).rejects.toThrow(
        'Reset setup is not allowed in production'
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should delete all users and reset setup flag', async () => {
      process.env.NODE_ENV = 'development';
      prisma.user.deleteMany.mockResolvedValue({ count: 2 });
      prisma.settings.findFirst.mockResolvedValue({ id: 'settings-1' });
      prisma.settings.update.mockResolvedValue({});

      const result = await service.resetSetup();

      expect(result.message).toContain('Setup reset successfully');
      expect(prisma.user.deleteMany).toHaveBeenCalled();
      expect(prisma.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { isSetupComplete: false },
      });
    });

    it('should handle reset when no settings exist', async () => {
      process.env.NODE_ENV = 'development';
      prisma.user.deleteMany.mockResolvedValue({ count: 0 });
      prisma.settings.findFirst.mockResolvedValue(null);

      const result = await service.resetSetup();

      expect(result.message).toContain('Setup reset successfully');
      expect(prisma.settings.update).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // initializeSetup – error paths and edge cases
  // ==========================================================================
  describe('initializeSetup – error paths', () => {
    const baseLicense = {
      id: 'license-1',
      key: 'FREE-abc',
      tier: 'FREE',
      status: 'ACTIVE',
    };

    it('should propagate prisma.license.create error when license creation fails', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({});
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(null);
      prisma.license.create.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.initializeSetup({
          username: 'admin',
          password: 'pass',
          allowLocalNetworkWithoutAuth: false,
          nodeType: NodeType.Main,
        })
      ).rejects.toThrow('DB connection lost');
    });

    it('should propagate nodeRepository.createNode error on main setup', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({});
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(baseLicense);
      prisma.node.create.mockRejectedValue(new Error('Node insert failed'));

      await expect(
        service.initializeSetup({
          username: 'admin',
          password: 'pass',
          allowLocalNetworkWithoutAuth: false,
          nodeType: NodeType.Main,
        })
      ).rejects.toThrow('Node insert failed');
    });

    it('should propagate nodeRepository.createNode error on child setup', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(baseLicense);
      prisma.node.create.mockRejectedValue(new Error('Child node insert failed'));

      await expect(
        service.initializeSetup({
          allowLocalNetworkWithoutAuth: false,
          nodeType: NodeType.Child,
          mainNodeUrl: 'http://192.168.1.100:3100',
        })
      ).rejects.toThrow('Child node insert failed');
    });

    it('should use HOSTNAME env var in node name for main setup', async () => {
      process.env.HOSTNAME = 'my-custom-host';
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({});
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(baseLicense);
      prisma.node.create.mockResolvedValue({});

      await service.initializeSetup({
        username: 'admin',
        password: 'pass',
        allowLocalNetworkWithoutAuth: false,
        nodeType: NodeType.Main,
      });

      expect(prisma.node.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Main Node (my-custom-host)' })
      );
      process.env.HOSTNAME = '';
    });

    it('should fall back to "main-node" hostname when HOSTNAME env is empty', async () => {
      process.env.HOSTNAME = '';
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({});
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(baseLicense);
      prisma.node.create.mockResolvedValue({});

      await service.initializeSetup({
        username: 'admin',
        password: 'pass',
        allowLocalNetworkWithoutAuth: false,
        nodeType: NodeType.Main,
      });

      expect(prisma.node.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Main Node (main-node)' })
      );
    });

    it('should use child-node email in FREE license when nodeType is Child', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(null);
      prisma.license.create.mockResolvedValue({ ...baseLicense, id: 'license-child' });
      prisma.node.create.mockResolvedValue({});

      await service.initializeSetup({
        allowLocalNetworkWithoutAuth: false,
        nodeType: NodeType.Child,
        mainNodeUrl: 'http://192.168.1.100:3100',
      });

      expect(prisma.license.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'child-node@bitbonsai.local' }),
        })
      );
    });

    it('should create FREE license with all required feature flags', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({});
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(null);
      prisma.license.create.mockResolvedValue(baseLicense);
      prisma.node.create.mockResolvedValue({});

      await service.initializeSetup({
        username: 'admin',
        password: 'pass',
        allowLocalNetworkWithoutAuth: false,
        nodeType: NodeType.Main,
      });

      expect(prisma.license.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tier: 'FREE',
            status: 'ACTIVE',
            maxNodes: 1,
            maxConcurrentJobs: 2,
            features: expect.objectContaining({
              multiNode: false,
              advancedPresets: false,
              api: false,
              priorityQueue: false,
              cloudStorage: false,
              webhooks: false,
            }),
          }),
        })
      );
    });

    it('should not create user when nodeType is Child', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(baseLicense);
      prisma.node.create.mockResolvedValue({});

      await service.initializeSetup({
        allowLocalNetworkWithoutAuth: false,
        nodeType: NodeType.Child,
        mainNodeUrl: 'http://192.168.1.100:3100',
      });

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should mark setup complete via settingsRepository for child node', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.settings.findFirst.mockResolvedValue(null);
      prisma.settings.create.mockResolvedValue({});
      prisma.license.findFirst.mockResolvedValue(baseLicense);
      prisma.node.create.mockResolvedValue({});

      await service.initializeSetup({
        allowLocalNetworkWithoutAuth: true,
        nodeType: NodeType.Child,
        mainNodeUrl: 'http://192.168.1.100:3100',
      });

      expect(mockSettingsRepository.upsertSettings).toHaveBeenCalledWith(
        expect.objectContaining({ isSetupComplete: true, allowLocalNetworkWithoutAuth: true })
      );
    });
  });
});
