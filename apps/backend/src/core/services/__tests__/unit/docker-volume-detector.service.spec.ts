import { Test, type TestingModule } from '@nestjs/testing';
import { DockerVolumeDetectorService } from '../../docker-volume-detector.service';

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

import { exec } from 'child_process';

const mockExec = exec as unknown as jest.Mock;

// Helper to simulate promisified exec
type ExecCallback = (error: Error | null, result: { stdout: string; stderr: string }) => void;

function mockExecResolve(stdout: string, stderr = '') {
  mockExec.mockImplementation((_cmd: string, callback: ExecCallback) => {
    callback(null, { stdout, stderr });
  });
}

function mockExecReject(error: Error) {
  mockExec.mockImplementation((_cmd: string, callback: ExecCallback) => {
    callback(error, { stdout: '', stderr: '' });
  });
}

function mockExecSequence(responses: Array<{ stdout?: string; stderr?: string; error?: Error }>) {
  let callIndex = 0;
  mockExec.mockImplementation((_cmd: string, callback: ExecCallback) => {
    const response = responses[callIndex] || responses[responses.length - 1];
    callIndex++;
    if (response.error) {
      callback(response.error, { stdout: '', stderr: '' });
    } else {
      callback(null, { stdout: response.stdout || '', stderr: response.stderr || '' });
    }
  });
}

describe('DockerVolumeDetectorService', () => {
  let service: DockerVolumeDetectorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DockerVolumeDetectorService],
    }).compile();

    service = module.get<DockerVolumeDetectorService>(DockerVolumeDetectorService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.clearCache();
  });

  describe('detectVolumes', () => {
    it('should return empty array when not in Docker', async () => {
      mockExecSequence([
        { stdout: 'false' }, // isRunningInDocker check
        { stdout: '' }, // cgroup check
      ]);

      const volumes = await service.detectVolumes();

      expect(volumes).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockExecReject(new Error('exec failed'));

      const volumes = await service.detectVolumes();

      expect(volumes).toEqual([]);
    });

    it('should return cached results on second call', async () => {
      // First call: not in Docker
      mockExecSequence([{ stdout: 'false' }, { stdout: '' }]);

      const first = await service.detectVolumes();

      // Modify mock, but cache should be used
      mockExecResolve('true');

      const second = await service.detectVolumes();

      expect(first).toEqual(second);
      expect(first).toEqual([]);
    });
  });

  describe('clearCache', () => {
    it('should clear cached volumes', async () => {
      // Populate cache
      mockExecSequence([{ stdout: 'false' }, { stdout: '' }]);
      await service.detectVolumes();

      service.clearCache();

      // Next call should re-detect
      mockExecSequence([{ stdout: 'false' }, { stdout: '' }]);
      const volumes = await service.detectVolumes();
      expect(volumes).toEqual([]);
    });
  });

  describe('getSuggestedShareName', () => {
    it('should convert /media to Media', () => {
      expect(service.getSuggestedShareName('/media')).toBe('Media');
    });

    it('should convert /data/videos to Data Videos', () => {
      expect(service.getSuggestedShareName('/data/videos')).toBe('Data Videos');
    });

    it('should handle trailing slashes', () => {
      expect(service.getSuggestedShareName('/media/')).toBe('Media');
    });

    it('should handle multiple path segments', () => {
      expect(service.getSuggestedShareName('/mnt/user/media')).toBe('Mnt User Media');
    });

    it('should capitalize first letter of each segment', () => {
      expect(service.getSuggestedShareName('/downloads')).toBe('Downloads');
    });
  });
});
