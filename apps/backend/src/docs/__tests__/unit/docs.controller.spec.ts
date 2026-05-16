import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { existsSync, readFileSync } from 'fs';
import { DocsController } from '../../docs.controller';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue(['REBALANCING.md']),
}));

const mockExistsSync = existsSync as jest.Mock;
const mockReadFileSync = readFileSync as jest.Mock;

describe('DocsController', () => {
  let controller: DocsController;

  const mockRes = {
    setHeader: jest.fn(),
    send: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocsController],
    }).compile();

    controller = module.get<DocsController>(DocsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getDoc', () => {
    it('should serve file content when file exists', () => {
      const content = '# REBALANCING\n\nSome docs here.';
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(content);

      controller.getDoc('REBALANCING', mockRes as never);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/markdown; charset=utf-8'
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600');
      expect(mockRes.send).toHaveBeenCalledWith(content);
    });

    it('should throw NotFoundException when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() => controller.getDoc('MISSING', mockRes as never)).toThrow(NotFoundException);
    });

    it('should sanitize filename to strip path traversal characters', () => {
      mockExistsSync.mockReturnValue(false);

      // Should not throw a different error — just NotFoundException for the sanitized path
      expect(() => controller.getDoc('../../../etc/passwd', mockRes as never)).toThrow(
        NotFoundException
      );
    });

    it('should throw NotFoundException when readFileSync throws', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('permission denied');
      });

      expect(() => controller.getDoc('REBALANCING', mockRes as never)).toThrow(NotFoundException);
    });
  });
});
