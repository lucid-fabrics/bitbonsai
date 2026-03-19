import { Test, type TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { UserRepository } from '../../user.repository';

const mockUser = {
  id: 'user-1',
  username: 'admin',
  email: 'admin@example.com',
  passwordHash: 'hashed',
  role: UserRole.ADMIN,
  isActive: true,
  refreshToken: null,
  refreshTokenExpiresAt: null,
  lastLoginAt: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockPrismaUser = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
  count: jest.fn(),
  groupBy: jest.fn(),
};

const mockPrisma = {
  user: mockPrismaUser,
};

describe('UserRepository', () => {
  let repository: UserRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [UserRepository, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    repository = module.get<UserRepository>(UserRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeInstanceOf(UserRepository);
  });

  describe('findById', () => {
    it('should return user when found', async () => {
      mockPrismaUser.findUnique.mockResolvedValue(mockUser);

      const result = await repository.findById('user-1');

      expect(result).toEqual(mockUser);
      expect(mockPrismaUser.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('should return null when not found', async () => {
      mockPrismaUser.findUnique.mockResolvedValue(null);

      const result = await repository.findById('ghost');

      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should return user by email', async () => {
      mockPrismaUser.findUnique.mockResolvedValue(mockUser);

      const result = await repository.findByEmail('admin@example.com');

      expect(result).toEqual(mockUser);
      expect(mockPrismaUser.findUnique).toHaveBeenCalledWith({
        where: { email: 'admin@example.com' },
      });
    });

    it('should return null when email not found', async () => {
      mockPrismaUser.findUnique.mockResolvedValue(null);

      const result = await repository.findByEmail('nobody@example.com');

      expect(result).toBeNull();
    });
  });

  describe('findByUsername', () => {
    it('should return user by username', async () => {
      mockPrismaUser.findUnique.mockResolvedValue(mockUser);

      const result = await repository.findByUsername('admin');

      expect(result).toEqual(mockUser);
      expect(mockPrismaUser.findUnique).toHaveBeenCalledWith({ where: { username: 'admin' } });
    });

    it('should return null when username not found', async () => {
      mockPrismaUser.findUnique.mockResolvedValue(null);

      const result = await repository.findByUsername('unknown');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all users ordered by createdAt desc', async () => {
      mockPrismaUser.findMany.mockResolvedValue([mockUser]);

      const result = await repository.findAll();

      expect(result).toEqual([mockUser]);
      expect(mockPrismaUser.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
    });
  });

  describe('findByRole', () => {
    it('should return users filtered by role', async () => {
      mockPrismaUser.findMany.mockResolvedValue([mockUser]);

      const result = await repository.findByRole(UserRole.ADMIN);

      expect(result).toEqual([mockUser]);
      expect(mockPrismaUser.findMany).toHaveBeenCalledWith({ where: { role: UserRole.ADMIN } });
    });
  });

  describe('create', () => {
    it('should create user with provided data and default role USER', async () => {
      const newUser = { ...mockUser, role: UserRole.USER };
      mockPrismaUser.create.mockResolvedValue(newUser);

      const result = await repository.create({
        username: 'admin',
        email: 'admin@example.com',
        passwordHash: 'hashed',
      });

      expect(result).toEqual(newUser);
      expect(mockPrismaUser.create).toHaveBeenCalledWith({
        data: {
          username: 'admin',
          email: 'admin@example.com',
          passwordHash: 'hashed',
          role: 'USER',
        },
      });
    });

    it('should use provided role when given', async () => {
      mockPrismaUser.create.mockResolvedValue(mockUser);

      await repository.create({
        username: 'admin',
        email: 'admin@example.com',
        passwordHash: 'hashed',
        role: UserRole.ADMIN,
      });

      expect(mockPrismaUser.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: UserRole.ADMIN }),
      });
    });
  });

  describe('update', () => {
    it('should update user by id', async () => {
      const updated = { ...mockUser, isActive: false };
      mockPrismaUser.update.mockResolvedValue(updated);

      const result = await repository.update('user-1', { isActive: false });

      expect(result).toEqual(updated);
      expect(mockPrismaUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isActive: false },
      });
    });

    it('should update refresh token fields', async () => {
      const token = 'refresh-token-xyz';
      const expiry = new Date('2025-12-31');
      mockPrismaUser.update.mockResolvedValue({ ...mockUser, refreshToken: token });

      await repository.update('user-1', { refreshToken: token, refreshTokenExpiresAt: expiry });

      expect(mockPrismaUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshToken: token, refreshTokenExpiresAt: expiry },
      });
    });
  });

  describe('delete', () => {
    it('should delete user by id', async () => {
      mockPrismaUser.delete.mockResolvedValue(mockUser);

      const result = await repository.delete('user-1');

      expect(result).toEqual(mockUser);
      expect(mockPrismaUser.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('should propagate error when user not found', async () => {
      mockPrismaUser.delete.mockRejectedValue(new Error('Record not found'));

      await expect(repository.delete('ghost')).rejects.toThrow('Record not found');
    });
  });

  describe('findByRefreshToken', () => {
    it('should return active user with matching refresh token', async () => {
      mockPrismaUser.findFirst.mockResolvedValue(mockUser);

      const result = await repository.findByRefreshToken('token-abc');

      expect(result).toEqual(mockUser);
      expect(mockPrismaUser.findFirst).toHaveBeenCalledWith({
        where: { refreshToken: 'token-abc', isActive: true },
      });
    });

    it('should return null when token not found', async () => {
      mockPrismaUser.findFirst.mockResolvedValue(null);

      const result = await repository.findByRefreshToken('invalid-token');

      expect(result).toBeNull();
    });
  });

  describe('count', () => {
    it('should return total user count', async () => {
      mockPrismaUser.count.mockResolvedValue(5);

      const result = await repository.count();

      expect(result).toBe(5);
      expect(mockPrismaUser.count).toHaveBeenCalledWith();
    });
  });

  describe('deleteMany', () => {
    it('should delete all users and return count', async () => {
      mockPrismaUser.deleteMany.mockResolvedValue({ count: 3 });

      const result = await repository.deleteMany();

      expect(result).toEqual({ count: 3 });
      expect(mockPrismaUser.deleteMany).toHaveBeenCalledWith({});
    });
  });

  describe('countByRole', () => {
    it('should return counts grouped by role', async () => {
      mockPrismaUser.groupBy.mockResolvedValue([
        { role: UserRole.ADMIN, _count: 1 },
        { role: UserRole.USER, _count: 4 },
      ]);

      const result = await repository.countByRole();

      expect(result[UserRole.ADMIN]).toBe(1);
      expect(result[UserRole.USER]).toBe(4);
      expect(mockPrismaUser.groupBy).toHaveBeenCalledWith({ by: ['role'], _count: true });
    });
  });
});
