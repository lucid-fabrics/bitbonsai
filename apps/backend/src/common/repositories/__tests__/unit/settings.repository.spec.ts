import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../prisma/prisma.service';
import { SettingsRepository } from '../../settings.repository';

const mockSettings = {
  id: 'settings-1',
  isSetupComplete: true,
  advancedModeEnabled: false,
  licenseKey: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockTx = {
  settings: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockPrisma = {
  settings: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('SettingsRepository', () => {
  let repository: SettingsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SettingsRepository, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    repository = module.get<SettingsRepository>(SettingsRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeInstanceOf(SettingsRepository);
  });

  describe('findFirst', () => {
    it('should return the first settings record', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(mockSettings);

      const result = await repository.findFirst();

      expect(result).toEqual(mockSettings);
      expect(mockPrisma.settings.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should return null when no settings exist', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(null);

      const result = await repository.findFirst();

      expect(result).toBeNull();
    });
  });

  describe('findUnique', () => {
    it('should return settings by id', async () => {
      mockPrisma.settings.findUnique.mockResolvedValue(mockSettings);

      const result = await repository.findUnique({ id: 'settings-1' });

      expect(result).toEqual(mockSettings);
      expect(mockPrisma.settings.findUnique).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
      });
    });

    it('should return null when id does not exist', async () => {
      mockPrisma.settings.findUnique.mockResolvedValue(null);

      const result = await repository.findUnique({ id: 'nonexistent' });

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create settings with provided data', async () => {
      mockPrisma.settings.create.mockResolvedValue(mockSettings);

      const result = await repository.create({
        isSetupComplete: true,
        advancedModeEnabled: false,
        licenseKey: 'key-123',
      });

      expect(result).toEqual(mockSettings);
      expect(mockPrisma.settings.create).toHaveBeenCalledWith({
        data: { isSetupComplete: true, advancedModeEnabled: false, licenseKey: 'key-123' },
      });
    });

    it('should create settings with empty data', async () => {
      mockPrisma.settings.create.mockResolvedValue(mockSettings);

      const result = await repository.create({});

      expect(result).toEqual(mockSettings);
      expect(mockPrisma.settings.create).toHaveBeenCalledWith({ data: {} });
    });

    it('should propagate errors', async () => {
      mockPrisma.settings.create.mockRejectedValue(new Error('DB error'));

      await expect(repository.create({})).rejects.toThrow('DB error');
    });
  });

  describe('update', () => {
    it('should update settings with partial data', async () => {
      const updated = { ...mockSettings, isSetupComplete: false };
      mockPrisma.settings.update.mockResolvedValue(updated);

      const result = await repository.update({ id: 'settings-1' }, { isSetupComplete: false });

      expect(result).toEqual(updated);
      expect(mockPrisma.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { isSetupComplete: false },
      });
    });

    it('should propagate errors when record not found', async () => {
      mockPrisma.settings.update.mockRejectedValue(new Error('Record not found'));

      await expect(repository.update({ id: 'ghost' }, { isSetupComplete: true })).rejects.toThrow(
        'Record not found'
      );
    });
  });

  describe('upsert', () => {
    it('should call prisma.settings.upsert with where, update and create', async () => {
      mockPrisma.settings.upsert.mockResolvedValue(mockSettings);

      const result = await repository.upsert({ id: 'settings-1' }, { isSetupComplete: true });

      expect(result).toEqual(mockSettings);
      expect(mockPrisma.settings.upsert).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        update: { isSetupComplete: true },
        create: { isSetupComplete: true },
      });
    });
  });

  describe('delete', () => {
    it('should delete settings by id', async () => {
      mockPrisma.settings.delete.mockResolvedValue(mockSettings);

      const result = await repository.delete({ id: 'settings-1' });

      expect(result).toEqual(mockSettings);
      expect(mockPrisma.settings.delete).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
      });
    });

    it('should propagate errors when record not found', async () => {
      mockPrisma.settings.delete.mockRejectedValue(new Error('Record to delete not found'));

      await expect(repository.delete({ id: 'ghost' })).rejects.toThrow(
        'Record to delete not found'
      );
    });
  });

  describe('findOrCreate', () => {
    it('should return existing settings when found', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(mockSettings);

      const result = await repository.findOrCreate();

      expect(result).toEqual(mockSettings);
      expect(mockPrisma.settings.create).not.toHaveBeenCalled();
    });

    it('should create and return new settings when none exist', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(null);
      mockPrisma.settings.create.mockResolvedValue(mockSettings);

      const result = await repository.findOrCreate();

      expect(result).toEqual(mockSettings);
      expect(mockPrisma.settings.create).toHaveBeenCalledWith({ data: {} });
    });
  });

  describe('upsertSettings', () => {
    it('should create settings inside transaction when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(mockSettings);
      mockPrisma.$transaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) =>
        cb(mockTx)
      );

      const result = await repository.upsertSettings({ isSetupComplete: true });

      expect(result).toEqual(mockSettings);
      expect(mockTx.settings.create).toHaveBeenCalledWith({
        data: { isSetupComplete: true },
      });
    });

    it('should update existing settings inside transaction', async () => {
      const updated = { ...mockSettings, licenseKey: 'new-key' };
      mockTx.settings.findFirst.mockResolvedValue(mockSettings);
      mockTx.settings.update.mockResolvedValue(updated);
      mockPrisma.$transaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) =>
        cb(mockTx)
      );

      const result = await repository.upsertSettings({ licenseKey: 'new-key' });

      expect(result).toEqual(updated);
      expect(mockTx.settings.update).toHaveBeenCalledWith({
        where: { id: mockSettings.id },
        data: { licenseKey: 'new-key' },
      });
    });
  });

  describe('findOrCreateWithDefaults', () => {
    it('should return existing settings without creating', async () => {
      mockTx.settings.findFirst.mockResolvedValue(mockSettings);
      mockPrisma.$transaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) =>
        cb(mockTx)
      );

      const result = await repository.findOrCreateWithDefaults({ isSetupComplete: false });

      expect(result).toEqual(mockSettings);
      expect(mockTx.settings.create).not.toHaveBeenCalled();
    });

    it('should create with defaults when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(mockSettings);
      mockPrisma.$transaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) =>
        cb(mockTx)
      );

      const result = await repository.findOrCreateWithDefaults({ isSetupComplete: true });

      expect(result).toEqual(mockSettings);
      expect(mockTx.settings.create).toHaveBeenCalledWith({
        data: { isSetupComplete: true },
      });
    });
  });
});
