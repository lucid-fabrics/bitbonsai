import { Test, type TestingModule } from '@nestjs/testing';

// Mock util before importing the service
jest.mock('util', () => ({
  promisify: jest.fn((fn) => fn),
}));

import { EncodingPreviewService } from '../../encoding-preview.service';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execFile: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
}));

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import * as fsp from 'fs/promises';

describe('EncodingPreviewService', () => {
  let service: EncodingPreviewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EncodingPreviewService],
    }).compile();

    service = module.get<EncodingPreviewService>(EncodingPreviewService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  const createMockProcess = (exitCode: number) => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdout.destroy = jest.fn();
    proc.stderr.destroy = jest.fn();
    proc.kill = jest.fn();

    (spawn as jest.Mock).mockReturnValue(proc);

    setTimeout(() => {
      proc.emit('close', exitCode);
    }, 10);

    return proc;
  };

  describe('generatePreviews', () => {
    it('should create preview directory', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);
      createMockProcess(0);

      await service.generatePreviews('job-1', '/tmp/encoded.mkv', 3600, 50);

      expect(fsp.mkdir).toHaveBeenCalledWith(expect.stringContaining('job-1'), { recursive: true });
    });

    it('should generate 9 preview screenshots', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);

      // Mock spawn to return successful process for each call
      (spawn as jest.Mock).mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.stdout.destroy = jest.fn();
        proc.stderr.destroy = jest.fn();
        proc.kill = jest.fn();

        setTimeout(() => proc.emit('close', 0), 5);

        return proc;
      });

      const result = await service.generatePreviews('job-1', '/tmp/encoded.mkv', 3600, 50);

      expect(spawn).toHaveBeenCalledTimes(9);
      expect(result.length).toBe(9);
    });

    it('should continue on individual preview failure', async () => {
      let callCount = 0;

      (spawn as jest.Mock).mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.stdout.destroy = jest.fn();
        proc.stderr.destroy = jest.fn();
        proc.kill = jest.fn();

        callCount++;
        const code = callCount === 3 ? 1 : 0; // Third call fails

        setTimeout(() => proc.emit('close', code), 5);

        return proc;
      });

      (existsSync as jest.Mock).mockReturnValue(true);

      const result = await service.generatePreviews('job-1', '/tmp/encoded.mkv', 3600, 100);

      // 8 successful + 1 failed = 8 previews
      expect(result.length).toBe(8);
    });

    it('should skip previews where file does not exist after extraction', async () => {
      (spawn as jest.Mock).mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.stdout.destroy = jest.fn();
        proc.stderr.destroy = jest.fn();
        proc.kill = jest.fn();

        setTimeout(() => proc.emit('close', 0), 5);

        return proc;
      });

      (existsSync as jest.Mock).mockReturnValue(false); // Files don't actually exist

      const result = await service.generatePreviews('job-1', '/tmp/encoded.mkv', 3600, 50);

      expect(result).toEqual([]);
    });

    it('should return empty array on directory creation failure', async () => {
      (fsp.mkdir as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      const result = await service.generatePreviews('job-1', '/tmp/encoded.mkv', 3600, 50);

      expect(result).toEqual([]);
    });

    it('should return sorted preview paths', async () => {
      (spawn as jest.Mock).mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.stdout.destroy = jest.fn();
        proc.stderr.destroy = jest.fn();
        proc.kill = jest.fn();

        setTimeout(() => proc.emit('close', 0), 5);

        return proc;
      });

      (existsSync as jest.Mock).mockReturnValue(true);

      const result = await service.generatePreviews('job-1', '/tmp/encoded.mkv', 3600, 100);

      // Verify sorted
      for (let i = 1; i < result.length; i++) {
        expect(result[i] >= result[i - 1]).toBe(true);
      }
    });
  });

  describe('cleanupPreviews', () => {
    it('should remove preview directory', async () => {
      await service.cleanupPreviews('job-1');

      expect(fsp.rm).toHaveBeenCalledWith(expect.stringContaining('job-1'), {
        recursive: true,
        force: true,
      });
    });

    it('should not throw on cleanup failure', async () => {
      (fsp.rm as jest.Mock).mockRejectedValue(new Error('Not found'));

      await expect(service.cleanupPreviews('job-1')).resolves.not.toThrow();
    });
  });

  describe('getPreviewPaths', () => {
    it('should return preview paths sorted', async () => {
      (fsp.readdir as jest.Mock).mockResolvedValue([
        'preview-3.jpg',
        'preview-1.jpg',
        'preview-2.jpg',
      ]);

      const result = await service.getPreviewPaths('job-1');

      expect(result).toHaveLength(3);
      expect(result[0]).toContain('preview-1.jpg');
      expect(result[1]).toContain('preview-2.jpg');
      expect(result[2]).toContain('preview-3.jpg');
    });

    it('should filter non-preview files', async () => {
      (fsp.readdir as jest.Mock).mockResolvedValue(['preview-1.jpg', 'thumbnail.png', 'README.md']);

      const result = await service.getPreviewPaths('job-1');

      expect(result).toHaveLength(1);
    });

    it('should return empty array when directory not found', async () => {
      (fsp.readdir as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const result = await service.getPreviewPaths('job-missing');

      expect(result).toEqual([]);
    });
  });
});
