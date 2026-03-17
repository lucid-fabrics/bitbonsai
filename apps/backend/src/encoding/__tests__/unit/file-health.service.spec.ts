import { Test, type TestingModule } from '@nestjs/testing';
import { FileHealthService, FileHealthStatus } from '../../file-health.service';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
}));

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';

describe('FileHealthService', () => {
  let service: FileHealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FileHealthService],
    }).compile();

    service = module.get<FileHealthService>(FileHealthService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  const createMockProcess = (exitCode: number, stdout: string, stderr = '') => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdout.destroy = jest.fn();
    proc.stderr.destroy = jest.fn();
    proc.kill = jest.fn();

    (spawn as jest.Mock).mockReturnValue(proc);

    setTimeout(() => {
      if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', exitCode);
    }, 10);

    return proc;
  };

  describe('analyzeFile', () => {
    it('should return CORRUPTED for non-existent files', async () => {
      (existsSync as jest.Mock).mockReturnValue(false);

      const result = await service.analyzeFile('/nonexistent/file.mkv');

      expect(result.status).toBe(FileHealthStatus.CORRUPTED);
      expect(result.score).toBe(0);
      expect(result.canEncode).toBe(false);
      expect(result.issues).toContain('File does not exist');
    });

    it('should return HEALTHY for a good file', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);

      const probeOutput = {
        format: { duration: '7200.5', bit_rate: '5000000' },
        streams: [
          { codec_name: 'hevc', codec_type: 'video' },
          { codec_name: 'aac', codec_type: 'audio' },
        ],
      };

      createMockProcess(0, JSON.stringify(probeOutput));

      const result = await service.analyzeFile('/test/good-file.mkv');

      expect(result.status).toBe(FileHealthStatus.HEALTHY);
      expect(result.score).toBeGreaterThanOrEqual(90);
      expect(result.canEncode).toBe(true);
      expect(result.metadata?.videoCodec).toBe('hevc');
      expect(result.metadata?.audioCodec).toBe('aac');
      expect(result.metadata?.duration).toBe(7200.5);
    });

    it('should detect missing video stream', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);

      const probeOutput = {
        format: { duration: '300', bit_rate: '128000' },
        streams: [{ codec_name: 'aac', codec_type: 'audio' }],
      };

      createMockProcess(0, JSON.stringify(probeOutput));

      const result = await service.analyzeFile('/test/audio-only.mp3');

      expect(result.issues).toContain('No video stream detected');
      expect(result.score).toBeLessThanOrEqual(60);
    });

    it('should warn about missing audio stream', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);

      const probeOutput = {
        format: { duration: '120', bit_rate: '5000000' },
        streams: [{ codec_name: 'h264', codec_type: 'video' }],
      };

      createMockProcess(0, JSON.stringify(probeOutput));

      const result = await service.analyzeFile('/test/no-audio.mkv');

      expect(result.warnings.some((w) => w.includes('No audio'))).toBe(true);
      expect(result.canEncode).toBe(true); // Still encodable
    });

    it('should detect corrupted container from stderr', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);

      const probeOutput = {
        format: { duration: '100' },
        streams: [{ codec_name: 'h264', codec_type: 'video' }],
      };

      createMockProcess(0, JSON.stringify(probeOutput), 'Invalid data found at processing');

      const result = await service.analyzeFile('/test/corrupt.mkv');

      expect(result.issues.some((i) => i.includes('invalid or corrupted'))).toBe(true);
      expect(result.score).toBeLessThan(90);
    });

    it('should detect moov atom issues', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);

      const probeOutput = {
        format: {},
        streams: [{ codec_name: 'h264', codec_type: 'video' }],
      };

      createMockProcess(0, JSON.stringify(probeOutput), 'moov atom not found');

      const result = await service.analyzeFile('/test/incomplete.mp4');

      expect(result.issues.some((i) => i.includes('MOOV atom'))).toBe(true);
    });

    it('should count warnings in stderr', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);

      const probeOutput = {
        format: { duration: '3600', bit_rate: '5000000' },
        streams: [
          { codec_name: 'h264', codec_type: 'video' },
          { codec_name: 'aac', codec_type: 'audio' },
        ],
      };

      createMockProcess(
        0,
        JSON.stringify(probeOutput),
        'Warning: some issue\nWarning: another issue'
      );

      const result = await service.analyzeFile('/test/warnings.mkv');

      expect(result.warnings.some((w) => w.includes('2 warning(s)'))).toBe(true);
    });

    it('should detect non-monotonous DTS issues', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);

      const probeOutput = {
        format: { duration: '3600', bit_rate: '5000000' },
        streams: [
          { codec_name: 'h264', codec_type: 'video' },
          { codec_name: 'aac', codec_type: 'audio' },
        ],
      };

      createMockProcess(0, JSON.stringify(probeOutput), 'non-monotonous dts in output');

      const result = await service.analyzeFile('/test/dts-issue.mkv');

      expect(result.warnings.some((w) => w.includes('Timestamp issues'))).toBe(true);
    });

    it('should handle ffprobe failure', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);

      createMockProcess(1, '', 'Error opening file');

      const result = await service.analyzeFile('/test/unreadable.mkv');

      expect(result.issues.some((i) => i.includes('FFProbe failed'))).toBe(true);
    });

    it('should handle ffprobe spawn error', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);

      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout.destroy = jest.fn();
      proc.stderr.destroy = jest.fn();
      proc.kill = jest.fn();

      (spawn as jest.Mock).mockReturnValue(proc);

      setTimeout(() => {
        proc.emit('error', new Error('ffprobe not found'));
      }, 10);

      const result = await service.analyzeFile('/test/file.mkv');

      expect(result.status).toBe(FileHealthStatus.CORRUPTED);
      expect(result.score).toBe(0);
    });

    it('should handle invalid JSON from ffprobe', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);

      createMockProcess(0, 'not valid json');

      const result = await service.analyzeFile('/test/file.mkv');

      expect(result.status).toBe(FileHealthStatus.CORRUPTED);
    });

    it('should clamp score between 0 and 100', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);

      const probeOutput = {
        format: { duration: '3600', bit_rate: '5000000' },
        streams: [
          { codec_name: 'h264', codec_type: 'video' },
          { codec_name: 'aac', codec_type: 'audio' },
        ],
      };

      createMockProcess(0, JSON.stringify(probeOutput));

      const result = await service.analyzeFile('/test/good.mkv');

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe('evaluateHealth', () => {
    it('should return HEALTHY for score >= 90', () => {
      const result = (service as any).evaluateHealth({
        exitCode: 0,
        stdout: '{}',
        stderr: '',
        duration: 3600,
        bitrate: 5000000,
        hasVideo: true,
        hasAudio: true,
        videoCodec: 'hevc',
        audioCodec: 'aac',
      });

      expect(result.status).toBe(FileHealthStatus.HEALTHY);
      expect(result.score).toBe(100);
    });

    it('should return WARNING for score 70-89', () => {
      const result = (service as any).evaluateHealth({
        exitCode: 0,
        stdout: '{}',
        stderr: 'warning: something\nwarning: else\nwarning: more\nwarning: extra\nwarning: five',
        duration: 3600,
        bitrate: 5000000,
        hasVideo: true,
        hasAudio: false,
      });

      expect(result.status).toBe(FileHealthStatus.WARNING);
      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.score).toBeLessThan(90);
    });

    it('should return CORRUPTED for score < 40', () => {
      const result = (service as any).evaluateHealth({
        exitCode: 1,
        stdout: '',
        stderr: 'invalid data corrupt',
        hasVideo: false,
        hasAudio: false,
      });

      expect(result.status).toBe(FileHealthStatus.CORRUPTED);
      expect(result.canEncode).toBe(false);
    });

    it('should include metadata in result', () => {
      const result = (service as any).evaluateHealth({
        exitCode: 0,
        stdout: '{}',
        stderr: '',
        duration: 120,
        bitrate: 3000000,
        hasVideo: true,
        hasAudio: true,
        videoCodec: 'h264',
        audioCodec: 'flac',
      });

      expect(result.metadata).toEqual({
        duration: 120,
        bitrate: 3000000,
        hasVideo: true,
        hasAudio: true,
        videoCodec: 'h264',
        audioCodec: 'flac',
      });
    });
  });
});
