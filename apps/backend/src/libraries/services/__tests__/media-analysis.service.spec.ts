import { Test, TestingModule } from '@nestjs/testing';
import {
  FileHealthStatus,
  MediaAnalysisService,
  type VideoCodecInfo,
} from '../../../media/media-analysis.service';

// Mock child_process.execFile
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

import { execFile } from 'child_process';

const execFileMock = execFile as unknown as jest.Mock;

/**
 * Helper to make execFile resolve with given stdout/stderr
 */
function mockExecFileResult(stdout: string, stderr = ''): void {
  execFileMock.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      // promisify calls execFile with a callback as last arg
      if (typeof cb === 'function') {
        cb(null, { stdout, stderr });
      } else if (typeof _opts === 'function') {
        // When called with 3 args (cmd, args, callback)
        (_opts as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, {
          stdout,
          stderr,
        });
      }
    }
  );
}

/**
 * Helper to make execFile reject with an error
 */
function mockExecFileError(message: string): void {
  execFileMock.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      if (typeof cb === 'function') {
        cb(new Error(message), { stdout: '', stderr: '' });
      } else if (typeof _opts === 'function') {
        (_opts as (err: Error | null) => void)(new Error(message));
      }
    }
  );
}

describe('MediaAnalysisService', () => {
  let service: MediaAnalysisService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MediaAnalysisService],
    }).compile();

    service = module.get<MediaAnalysisService>(MediaAnalysisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateFileIntegrity', () => {
    it('should return HEALTHY for a valid video file', async () => {
      const probeOutput = JSON.stringify({
        format: { format_name: 'matroska', duration: '120.5' },
        streams: [{ codec_type: 'video', codec_name: 'hevc' }],
      });
      mockExecFileResult(probeOutput);

      const result = await service.validateFileIntegrity('/path/to/video.mkv');

      expect(result.status).toBe(FileHealthStatus.HEALTHY);
      expect(result.message).toBe('File validated successfully');
    });

    it('should return WARNING when ffprobe reports stderr warnings', async () => {
      const probeOutput = JSON.stringify({
        format: { format_name: 'matroska', duration: '120.5' },
        streams: [{ codec_type: 'video', codec_name: 'hevc' }],
      });
      mockExecFileResult(probeOutput, 'some warning about packet timestamps');

      const result = await service.validateFileIntegrity('/path/to/video.mkv');

      expect(result.status).toBe(FileHealthStatus.WARNING);
      expect(result.message).toContain('FFprobe warnings');
    });

    it('should return CORRUPTED when JSON parse fails', async () => {
      mockExecFileResult('not valid json');

      const result = await service.validateFileIntegrity('/path/to/bad.mkv');

      expect(result.status).toBe(FileHealthStatus.CORRUPTED);
      expect(result.message).toBe('Failed to parse media file metadata');
    });

    it('should return CORRUPTED when format or streams are missing', async () => {
      mockExecFileResult(JSON.stringify({ format: null, streams: [] }));

      const result = await service.validateFileIntegrity('/path/to/empty.mkv');

      expect(result.status).toBe(FileHealthStatus.CORRUPTED);
      expect(result.message).toContain('missing format or streams');
    });

    it('should return CORRUPTED when no video stream exists', async () => {
      mockExecFileResult(
        JSON.stringify({
          format: { format_name: 'mp3', duration: '180' },
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
        })
      );

      const result = await service.validateFileIntegrity('/path/to/audio.mp3');

      expect(result.status).toBe(FileHealthStatus.CORRUPTED);
      expect(result.message).toBe('No video stream found in file');
    });

    it('should return WARNING when duration is zero or missing', async () => {
      mockExecFileResult(
        JSON.stringify({
          format: { format_name: 'matroska', duration: '0' },
          streams: [{ codec_type: 'video', codec_name: 'h264' }],
        })
      );

      const result = await service.validateFileIntegrity('/path/to/incomplete.mkv');

      expect(result.status).toBe(FileHealthStatus.WARNING);
      expect(result.message).toContain('Invalid or missing duration');
    });

    it('should return CORRUPTED when ffprobe command fails', async () => {
      mockExecFileError('Command failed: ffprobe');

      const result = await service.validateFileIntegrity('/path/to/missing.mkv');

      expect(result.status).toBe(FileHealthStatus.CORRUPTED);
      expect(result.message).toContain('Integrity check failed');
    });
  });

  describe('needsEncoding', () => {
    const baseVideoInfo: VideoCodecInfo = {
      filePath: '/path/to/video.mkv',
      codec: 'H.264',
      resolution: '1920x1080',
      duration: 120,
      sizeBytes: 1000000,
      healthStatus: FileHealthStatus.HEALTHY,
      healthMessage: 'OK',
    };

    it('should return true when current codec differs from target', () => {
      expect(service.needsEncoding(baseVideoInfo, 'HEVC')).toBe(true);
    });

    it('should return false when current codec matches target', () => {
      const hevcVideo = { ...baseVideoInfo, codec: 'HEVC' };
      expect(service.needsEncoding(hevcVideo, 'HEVC')).toBe(false);
    });

    it('should perform case-insensitive comparison', () => {
      const hevcVideo = { ...baseVideoInfo, codec: 'hevc' };
      expect(service.needsEncoding(hevcVideo, 'HEVC')).toBe(false);
    });

    it('should return true for H.264 to AV1 conversion', () => {
      expect(service.needsEncoding(baseVideoInfo, 'AV1')).toBe(true);
    });
  });

  describe('probeVideoFile', () => {
    it('should return null for corrupted files when integrity validation is enabled', async () => {
      // First call (validateFileIntegrity) returns corrupted
      execFileMock.mockImplementationOnce(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          if (typeof cb === 'function') {
            cb(null, {
              stdout: JSON.stringify({ format: null, streams: [] }),
              stderr: '',
            });
          }
        }
      );

      const result = await service.probeVideoFile('/path/to/corrupted.mkv');

      expect(result).toBeNull();
    });

    it('should return null when ffprobe fails to parse JSON', async () => {
      // Integrity check passes
      const healthyOutput = JSON.stringify({
        format: { format_name: 'matroska', duration: '120' },
        streams: [{ codec_type: 'video', codec_name: 'h264' }],
      });

      let callCount = 0;
      execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          callCount++;
          if (typeof cb === 'function') {
            cb(null, {
              stdout: callCount === 1 ? healthyOutput : 'invalid json',
              stderr: '',
            });
          }
        }
      );

      const result = await service.probeVideoFile('/path/to/video.mkv');

      expect(result).toBeNull();
    });

    it('should return null when no video streams found in probe', async () => {
      const healthyOutput = JSON.stringify({
        format: { format_name: 'matroska', duration: '120' },
        streams: [{ codec_type: 'video', codec_name: 'h264' }],
      });
      const noStreamsOutput = JSON.stringify({
        format: { duration: '120', size: '5000000' },
        streams: [],
      });

      let callCount = 0;
      execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          callCount++;
          if (typeof cb === 'function') {
            cb(null, {
              stdout: callCount === 1 ? healthyOutput : noStreamsOutput,
              stderr: '',
            });
          }
        }
      );

      const result = await service.probeVideoFile('/path/to/audio.mp3');

      expect(result).toBeNull();
    });

    it('should normalize H264 codec name to H.264', async () => {
      const healthyOutput = JSON.stringify({
        format: { format_name: 'matroska', duration: '120' },
        streams: [{ codec_type: 'video', codec_name: 'h264' }],
      });
      const probeOutput = JSON.stringify({
        format: { duration: '120.5', size: '5000000' },
        streams: [{ codec_name: 'h264', width: 1920, height: 1080 }],
      });

      let callCount = 0;
      execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          callCount++;
          if (typeof cb === 'function') {
            cb(null, {
              stdout: callCount === 1 ? healthyOutput : probeOutput,
              stderr: '',
            });
          }
        }
      );

      const result = await service.probeVideoFile('/path/to/video.mp4');

      expect(result).not.toBeNull();
      expect(result!.codec).toBe('H.264');
      expect(result!.resolution).toBe('1920x1080');
      expect(result!.duration).toBe(120.5);
      expect(result!.sizeBytes).toBe(5000000);
      expect(result!.filePath).toBe('/path/to/video.mp4');
    });

    it('should skip integrity validation when validateIntegrity is false', async () => {
      const probeOutput = JSON.stringify({
        format: { duration: '60', size: '2000000' },
        streams: [{ codec_name: 'hevc', width: 3840, height: 2160 }],
      });
      mockExecFileResult(probeOutput);

      const result = await service.probeVideoFile('/path/to/video.mkv', false);

      expect(result).not.toBeNull();
      expect(result!.codec).toBe('HEVC');
      expect(result!.resolution).toBe('3840x2160');
      expect(result!.healthStatus).toBe(FileHealthStatus.UNKNOWN);
      // Only one call to execFile (probe only, no integrity check)
      expect(execFileMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('analyzeFiles', () => {
    it('should return empty analysis for empty file list', async () => {
      const result = await service.analyzeFiles([], 'HEVC');

      expect(result.totalFiles).toBe(0);
      expect(result.needsEncoding).toHaveLength(0);
      expect(result.alreadyOptimized).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.totalSizeBytes).toBe(BigInt(0));
    });

    it('should record errors when probeVideoFile returns null', async () => {
      // Make integrity check return corrupted (so probe returns null)
      mockExecFileResult(JSON.stringify({ format: null, streams: [] }));

      const result = await service.analyzeFiles(['/path/to/bad.mkv'], 'HEVC');

      expect(result.totalFiles).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].filePath).toBe('/path/to/bad.mkv');
      expect(result.errors[0].error).toBe('Failed to probe file');
    });

    it('should accumulate total size across multiple files', async () => {
      const healthyOutput = JSON.stringify({
        format: { format_name: 'matroska', duration: '120' },
        streams: [{ codec_type: 'video', codec_name: 'h264' }],
      });
      const probeOutput = JSON.stringify({
        format: { duration: '60', size: '1000' },
        streams: [{ codec_name: 'h264', width: 1920, height: 1080 }],
      });

      execFileMock.mockImplementation(
        (
          _cmd: string,
          args: string[],
          _opts: unknown,
          cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          // Distinguish integrity check vs probe by args: integrity uses -show_entries format=format_name,...
          const isIntegrityCheck = args.some((a: string) => a.includes('format_name'));
          if (typeof cb === 'function') {
            cb(null, {
              stdout: isIntegrityCheck ? healthyOutput : probeOutput,
              stderr: '',
            });
          }
        }
      );

      const result = await service.analyzeFiles(['/path/a.mkv', '/path/b.mkv'], 'HEVC', 5);

      expect(result.totalFiles).toBe(2);
      expect(result.totalSizeBytes).toBe(BigInt(2000));
      expect(result.needsEncoding).toHaveLength(2);
    });

    it('should add all valid files to needsEncoding regardless of codec match', async () => {
      const healthyOutput = JSON.stringify({
        format: { format_name: 'matroska', duration: '120' },
        streams: [{ codec_type: 'video', codec_name: 'hevc' }],
      });

      let callCount = 0;
      execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          callCount++;
          const isIntegrityCheck = callCount % 2 === 1;
          if (typeof cb === 'function') {
            cb(null, {
              stdout: isIntegrityCheck
                ? healthyOutput
                : JSON.stringify({
                    format: { duration: '60', size: '500' },
                    streams: [{ codec_name: 'hevc', width: 1920, height: 1080 }],
                  }),
              stderr: '',
            });
          }
        }
      );

      // Target is HEVC and file is already HEVC — should still be in needsEncoding
      const result = await service.analyzeFiles(['/path/already-hevc.mkv'], 'HEVC');

      expect(result.needsEncoding).toHaveLength(1);
      expect(result.alreadyOptimized).toHaveLength(0);
    });
  });
});
